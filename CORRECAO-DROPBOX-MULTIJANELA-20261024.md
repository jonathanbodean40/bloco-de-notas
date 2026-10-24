# Bloco de Notas Pro — correção de concorrência entre janelas (24/10/2026)

## Observação no MSI real

Depois da ativação do Dropbox principal, foi criada uma nota exclusivamente fictícia no MSI.
A nota foi carregada automaticamente para o Dropbox e o índice passou de 43 para 44 entradas.
Quando o título da mesma nota foi editado noutra janela do Chrome, a interface anunciou um conflito
e conservou a versão local renomeada e a versão Dropbox anterior.

Nota de teste (não clínica): ID 51519d10-a242-4083-bb36-cb90a8483745.
Não foi apagada ou substituída nenhuma nota clínica.

## Causa provável e proteção implementada

O ficheiro dropbox-primary.js guardava TODOS os checkpoints das notas num só objeto JSON do
localStorage. Com duas janelas da mesma origem, uma janela podia ler um mapa antigo e guardá-lo
mais tarde, apagando os checkpoints de notas sincronizadas pela outra janela. Isto pode gerar
um falso conflito mesmo quando o ficheiro remoto não foi editado noutro dispositivo.

Agora cada nota tem a sua chave de checkpoint distinta, em localStorage:
notas-pro:dropbox-primary-map:v1:<owner>:note:<id>

O mapa antigo continua disponível apenas para leitura como compatibilidade.
O motor lê a versão anterior e sobrepõe os checkpoints individuais.
Nenhuma operação de sincronização grava o mapa inteiro, evitando perda de informações
de notas diferentes em janelas concorrentes.

A política Dropbox de upload por revisão mantém-se ativa e não permite sobrescrever
alterações verdadeiramente divergentes.

## Validação

- 34 testes Node (Dropbox, OAuth, autenticação e concorrência): aprovados.
- 11 cenários de browser isolado e 149 verificações: aprovados.
- Novo caso de regressão: dois separadores partilham armazenamento; um deles atualiza nota A
  com snapshot obsoleto após a nota B ter sido enviada. A revisão de B é preservada.
- O teste confirma que alterar o título da nota B gera atualização condicional sem conflito.
- Os dados de trabalho não foram alterados pelo desenvolvimento.

## Limitações

Um conflito já produzido antes da atualização v44 não é automaticamente eliminado:
é preciso revê-lo e resolver apenas a nota fictícia ou a nota específica, conservando
ambas as versões quando necessário. A nova versão evita perder checkpoints entre
notas diferentes no futuro, mas não substitui gestão de concorrência por revisão remota.

Após publicação, recomenda-se atualizar a app em ambos os dispositivos, sem limpar dados locais,
e testar novamente a nota fictícia antes de considerar o modo multidispositivo validado.
