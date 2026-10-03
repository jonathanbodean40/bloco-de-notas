"""
Local Drag-and-Drop Web Application for Dental 3D Mesh Trimming.
"""

import os
import zipfile
import io
import tempfile
import webbrowser
from flask import Flask, request, send_file, render_template_string, jsonify
from dental_mesh_trimmer.processor import DentalMeshProcessor

app = Flask(__name__)

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cortador e Limpador de Modelos 3D Dentários</title>
    <style>
        :root {
            --primary: #0284c7;
            --primary-hover: #0369a1;
            --bg: #f8fafc;
            --card-bg: #ffffff;
            --text: #0f172a;
            --border: #cbd5e1;
        }

        body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            margin: 0;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
        }

        .container {
            max-width: 750px;
            width: 100%;
            background: var(--card-bg);
            border-radius: 16px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
            padding: 32px;
            margin-top: 20px;
        }

        header {
            text-align: center;
            margin-bottom: 24px;
        }

        h1 {
            font-size: 1.8rem;
            color: #0369a1;
            margin: 0 0 8px 0;
        }

        p.subtitle {
            color: #64748b;
            font-size: 0.95rem;
            margin: 0;
        }

        .drop-zone {
            border: 3px dashed #93c5fd;
            border-radius: 12px;
            padding: 40px 20px;
            text-align: center;
            background-color: #f0f9ff;
            cursor: pointer;
            transition: all 0.2s ease;
            margin-bottom: 24px;
            position: relative;
        }

        .drop-zone:hover, .drop-zone.dragover {
            border-color: var(--primary);
            background-color: #e0f2fe;
            transform: translateY(-2px);
        }

        .drop-zone-icon {
            font-size: 48px;
            color: var(--primary);
            margin-bottom: 12px;
        }

        .drop-zone-text {
            font-size: 1.1rem;
            font-weight: 600;
            color: #1e293b;
            margin-bottom: 6px;
        }

        .drop-zone-hint {
            font-size: 0.85rem;
            color: #64748b;
        }

        input[type="file"] {
            display: none;
        }

        .settings-panel {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 24px;
        }

        .setting-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }

        .setting-item:last-child {
            margin-bottom: 0;
        }

        label {
            font-weight: 500;
            font-size: 0.9rem;
        }

        input[type="range"] {
            width: 160px;
        }

        .file-list {
            margin-top: 16px;
            max-height: 200px;
            overflow-y: auto;
        }

        .file-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: #fff;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            margin-bottom: 6px;
            font-size: 0.9rem;
        }

        .btn {
            display: inline-block;
            width: 100%;
            background-color: var(--primary);
            color: white;
            font-weight: 600;
            font-size: 1rem;
            padding: 14px 24px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.2s ease;
            text-align: center;
            box-sizing: border-box;
        }

        .btn:hover {
            background-color: var(--primary-hover);
        }

        .btn:disabled {
            background-color: #94a3b8;
            cursor: not-allowed;
        }

        #status-message {
            margin-top: 16px;
            text-align: center;
            font-weight: 500;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .spinner {
            display: inline-block;
            width: 18px;
            height: 18px;
            border: 3px solid rgba(255,255,255,.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 1s ease-in-out infinite;
            margin-right: 8px;
            vertical-align: middle;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🦷 Cortador & Limpador de Modelos 3D Dentários</h1>
            <p class="subtitle">Arraste seus arquivos de escaneamento (.STL, .PLY, .OBJ) e o sistema fará a limpeza automática mantendo 100% de precisão dimensional dos dentes.</p>
        </header>

        <form id="upload-form">
            <div class="drop-zone" id="drop-zone">
                <div class="drop-zone-icon">📁</div>
                <div class="drop-zone-text">Arraste seus arquivos ou pasta de modelos 3D para aqui</div>
                <div class="drop-zone-hint">Suporta arquivos .STL, .PLY e .OBJ</div>
                <input type="file" id="file-input" name="files" multiple accept=".stl,.ply,.obj,.STL,.PLY,.OBJ">
            </div>

            <div class="file-list" id="file-list"></div>

            <div class="settings-panel">
                <div class="setting-item">
                    <label for="cut-percentile">Altura do Corte da Gengiva:</label>
                    <div>
                        <input type="range" id="cut-percentile" name="cut_percentile" min="5" max="40" value="20" oninput="document.getElementById('cut-val').innerText = this.value + '%'">
                        <span id="cut-val" style="font-weight:bold; margin-left:8px;">20%</span>
                    </div>
                </div>
                <div class="setting-item">
                    <label for="create-base">Fechar Base Plana para Impressão 3D:</label>
                    <input type="checkbox" id="create-base" name="create_base" checked style="width:20px; height:20px;">
                </div>
            </div>

            <button type="submit" class="btn" id="process-btn" disabled>Iniciar Corte e Limpeza Automática</button>
        </form>

        <div id="status-message"></div>
    </div>

    <script>
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');
        const fileList = document.getElementById('file-list');
        const processBtn = document.getElementById('process-btn');
        const form = document.getElementById('upload-form');
        const statusMsg = document.getElementById('status-message');

        let selectedFiles = [];

        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
            }, false);
        });

        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            handleFiles(dt.files);
        });

        fileInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
        });

        function handleFiles(files) {
            for (let file of files) {
                const ext = file.name.split('.').pop().toLowerCase();
                if (['stl', 'ply', 'obj'].includes(ext)) {
                    selectedFiles.push(file);
                }
            }
            updateFileList();
        }

        function updateFileList() {
            fileList.innerHTML = '';
            selectedFiles.forEach((file, index) => {
                const item = document.createElement('div');
                item.className = 'file-item';
                item.innerHTML = `
                    <span>📄 ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                    <button type="button" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold" onclick="removeFile(${index})">✕</button>
                `;
                fileList.appendChild(item);
            });

            processBtn.disabled = selectedFiles.length === 0;
            statusMsg.innerText = '';
        }

        function removeFile(index) {
            selectedFiles.splice(index, 1);
            updateFileList();
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (selectedFiles.length === 0) return;

            processBtn.disabled = true;
            processBtn.innerHTML = '<span class="spinner"></span> Processando modelos 3D... Aguarde';
            statusMsg.style.color = '#0284c7';
            statusMsg.innerText = 'Limpando gengiva, removendo ruídos e preservando anatomia...';

            const formData = new FormData();
            selectedFiles.forEach(file => {
                formData.append('files', file);
            });
            formData.append('cut_percentile', document.getElementById('cut-percentile').value);
            formData.append('create_base', document.getElementById('create-base').checked);

            try {
                const response = await fetch('/process', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    let errText = 'Erro ao processar modelos 3D.';
                    try {
                        const errData = await response.json();
                        if (errData && errData.error) errText = errData.error;
                    } catch (e) {}
                    throw new Error(errText);
                }

                const blob = await response.blob();
                const downloadUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = downloadUrl;

                if (selectedFiles.length === 1) {
                    const originalName = selectedFiles[0].name;
                    a.download = 'cortado_' + originalName;
                } else {
                    a.download = 'modelos_dentarios_cortados.zip';
                }

                document.body.appendChild(a);
                a.click();
                a.remove();

                statusMsg.style.color = '#16a34a';
                statusMsg.innerText = '✅ Processamento concluído com sucesso! Download iniciado.';
            } catch (err) {
                statusMsg.style.color = '#dc2626';
                statusMsg.innerText = '❌ ' + err.message;
            } finally {
                processBtn.disabled = false;
                processBtn.innerText = 'Iniciar Corte e Limpeza Automática';
            }
        });
    </script>
</body>
</html>
"""

@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)


@app.route('/process', methods=['POST'])
def process_files():
    uploaded_files = request.files.getlist('files')
    cut_percentile = float(request.form.get('cut_percentile', 20.0))
    create_base = request.form.get('create_base') == 'true'

    if not uploaded_files:
        return jsonify({'error': 'Nenhum arquivo foi enviado'}), 400

    processed_results = []

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            for file in uploaded_files:
                filename = file.filename
                if not filename:
                    continue
                input_path = os.path.join(tmpdir, filename)
                file.save(input_path)

                try:
                    processor = DentalMeshProcessor.from_file(input_path)
                    processor.process(
                        min_artifact_ratio=0.05,
                        cut_height_percentile=cut_percentile,
                        create_base=create_base
                    )

                    out_filename = f"cortado_{filename}"
                    output_path = os.path.join(tmpdir, out_filename)
                    processor.save(output_path)
                    processed_results.append((out_filename, output_path))
                except Exception as ex:
                    return jsonify({'error': f'Falha no arquivo "{filename}": {str(ex)}'}), 400

            if not processed_results:
                return jsonify({'error': 'Nenhum modelo 3D válido foi processado'}), 400

            if len(processed_results) == 1:
                out_filename, output_path = processed_results[0]
                with open(output_path, 'rb') as f:
                    data = io.BytesIO(f.read())
                return send_file(
                    data,
                    as_attachment=True,
                    download_name=out_filename,
                    mimetype='application/octet-stream'
                )
            else:
                zip_buffer = io.BytesIO()
                with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                    for out_filename, output_path in processed_results:
                        zip_file.write(output_path, arcname=out_filename)
                zip_buffer.seek(0)
                return send_file(
                    zip_buffer,
                    as_attachment=True,
                    download_name='modelos_dentarios_cortados.zip',
                    mimetype='application/zip'
                )
    except Exception as e:
        return jsonify({'error': f'Erro de processamento: {str(e)}'}), 500


def start_gui(port=5000, open_browser=True):
    url = f"http://localhost:{port}"
    print(f"\n=======================================================")
    print(f"🦷 APLICAÇÃO DENTÁRIA 3D INICIADA COM SUCESSO!")
    print(f"Abra o seu navegador no endereço: {url}")
    print(f"=======================================================\n")
    if open_browser:
        webbrowser.open(url)
    app.run(host='0.0.0.0', port=port, debug=False)


if __name__ == '__main__':
    start_gui()
