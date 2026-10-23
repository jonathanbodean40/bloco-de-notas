/* Dropbox adapter for Notas Exclusivas Pro.
 * Pure data helpers and transport: no OAuth tokens, secrets, browser profile,
 * automatic network calls, or production writes on module load.
 */
(function (root) {
  'use strict';

  const FORMAT = 'notas-exclusivas-pro/dropbox-v1';
  const MAX_BYTES = 150 * 1024 * 1024;
  const JSON_TYPE = 'application/json';

  function string(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(label + ' inválido');
    return value;
  }

  function folderPath(value) {
    if (value === '' || value === '/') return '';
    string(value, 'Pasta Dropbox');
    const path = value.startsWith('/') ? value : '/' + value;
    const segments = path.split('/').slice(1);
    if (segments.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f]/.test(part))) {
      throw new TypeError('Caminho de pasta inválido');
    }
    return path;
  }

  function noteFilename(note) {
    string(note.id, 'ID da nota');
    const safeId = note.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 90);
    const title = (note.title || 'Sem título').normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 _-]/g, '')
      .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 75) || 'nota';
    return title + '--' + safeId + '.keepnote.json';
  }

  function notePath(folder, note) {
    return folderPath(folder) + '/' + noteFilename(note);
  }

  function deepLink(base, scope, id) {
    const uri = new URL(string(base, 'Endereço da aplicação'));
    if (!/^https?:$/.test(uri.protocol)) throw new TypeError('Endereço inválido');
    uri.hash = '';
    uri.search = '';
    uri.searchParams.set('note', string(id, 'ID da nota'));
    uri.searchParams.set('scope', string(scope, 'Utilizador'));
    return uri.href;
  }

  function serialize(note, scope, base, now) {
    if (!note || typeof note !== 'object') throw new TypeError('Nota inválida');
    string(note.id, 'ID da nota');
    if (typeof note.content !== 'string') throw new TypeError('Conteúdo inválido');
    if (Number.isNaN(Date.parse(note.updatedAt || ''))) throw new TypeError('Data inválida');
    const data = {
      format: FORMAT,
      owner: string(scope, 'Utilizador'),
      note: {
        id: note.id,
        title: String(note.title || ''),
        titleHtml: String(note.titleHtml || ''),
        content: note.content,
        updatedAt: note.updatedAt,
        deletedAt: note.deletedAt || null
      },
      openUrl: deepLink(base, scope, note.id),
      exportedAt: now || new Date().toISOString()
    };
    return JSON.stringify(data);
  }

  function deserialize(raw, expectedOwner) {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!payload || payload.format !== FORMAT || payload.owner !== string(expectedOwner, 'Utilizador')) {
      throw new TypeError('Ficheiro incompatível com a conta atual');
    }
    const note = payload.note;
    if (!note || typeof note.id !== 'string' || !note.id || typeof note.content !== 'string'
      || Number.isNaN(Date.parse(note.updatedAt || ''))) {
      throw new TypeError('Nota de backup inválida');
    }
    return {
      id: note.id, title: String(note.title || ''), titleHtml: String(note.titleHtml || ''),
      content: note.content, updatedAt: note.updatedAt, deletedAt: note.deletedAt || null
    };
  }

  function importableNote(raw, owner, filename) {
    const note = deserialize(raw, owner);
    const match = /--([a-zA-Z0-9_-]+)\.keepnote\.json$/i.exec(String(filename || ''));
    const safeId = note.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 90);
    if (!match || match[1] !== safeId || note.deletedAt) {
      throw new TypeError('Ficheiro Dropbox incompatível com a nota ou excluído');
    }
    return note;
  }

  function revisionDecision(local, remote, knownRevision) {
    if (!remote) return 'create';
    if (!local) return 'remote-only';
    if (local.id !== remote.id) return 'different-note';
    if (local.content === remote.content && local.title === remote.title
      && local.titleHtml === remote.titleHtml && local.deletedAt === remote.deletedAt) return 'unchanged';
    // A remote change is never overwritten without checking its Dropbox revision.
    if (!knownRevision) return 'review';
    const a = Date.parse(local.updatedAt);
    const b = Date.parse(remote.updatedAt);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return 'review';
    return a > b ? 'upload-if-revision-matches' : 'download-if-local-unchanged';
  }

  class DropboxError extends Error {
    constructor(message, status, details) {
      super(message);
      this.name = 'DropboxError';
      this.status = status;
      this.details = details;
    }
  }

  class Client {
    constructor(options) {
      if (!options || typeof options.getToken !== 'function') throw new TypeError('É necessário um fornecedor de token');
      this.getToken = options.getToken;
      this.fetch = options.fetch || root.fetch?.bind(root);
      if (!this.fetch) throw new TypeError('Fetch indisponível');
    }

    async request(host, endpoint, data, isContent) {
      const token = string(await this.getToken(), 'Token Dropbox');
      const options = {method: 'POST', headers: {Authorization: 'Bearer ' + token}, cache: 'no-store'};
      if (isContent) {
        options.headers['Dropbox-API-Arg'] = JSON.stringify(data.args);
        if (data.body !== undefined) {
          options.headers['Content-Type'] = 'application/octet-stream';
          options.body = data.body;
        }
      } else {
        options.headers['Content-Type'] = JSON_TYPE;
        options.body = JSON.stringify(data);
      }
      let response;
      try { response = await this.fetch(host + endpoint, options); }
      catch (e) { throw new DropboxError('Sem ligação ao Dropbox', 0, e?.message || 'Falha de rede'); }
      if (!response.ok) {
        let description = '';
        try { description = await response.text(); } catch (_) {}
        throw new DropboxError('Dropbox devolveu HTTP ' + response.status, response.status, description.slice(0, 2000));
      }
      return response;
    }

    async listFolder(folder) {
      const entries = [];
      let response = await this.request('https://api.dropboxapi.com/2', '/files/list_folder', {
        path: folderPath(folder), recursive: false, include_deleted: false
      });
      let data = await response.json();
      entries.push(...(data.entries || []));
      while (data.has_more) {
        response = await this.request('https://api.dropboxapi.com/2', '/files/list_folder/continue', {cursor: data.cursor});
        data = await response.json();
        entries.push(...(data.entries || []));
      }
      return entries;
    }

    async createFolder(path) {
      const response = await this.request('https://api.dropboxapi.com/2', '/files/create_folder_v2',
        {path: folderPath(path), autorename: false});
      return response.json();
    }

    async upload(path, contents, knownRevision) {
      string(path, 'Caminho do ficheiro');
      if (typeof contents !== 'string') throw new TypeError('Conteúdo de backup inválido');
      const bytes = new TextEncoder().encode(contents);
      if (bytes.byteLength > MAX_BYTES) throw new RangeError('Ficheiro demasiado grande para carregamento simples');
      const mode = knownRevision ? {'.tag': 'update', update: knownRevision} : {'.tag': 'add'};
      const response = await this.request('https://content.dropboxapi.com/2', '/files/upload', {
        args: {path, mode, autorename: false, mute: true, strict_conflict: true}, body: bytes
      }, true);
      return response.json();
    }

    async download(path) {
      string(path, 'Caminho do ficheiro');
      const response = await this.request('https://content.dropboxapi.com/2', '/files/download',
        {args: {path}}, true);
      return response.text();
    }

    async metadata(path) {
      string(path, 'Caminho do ficheiro');
      const response = await this.request('https://api.dropboxapi.com/2', '/files/get_metadata', {path});
      return response.json();
    }
  }

  const API = Object.freeze({FORMAT, folderPath, noteFilename, notePath, deepLink,
    serialize, deserialize, importableNote, revisionDecision, Client, DropboxError});
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.NotasDropboxStorage = API;
})(globalThis);
