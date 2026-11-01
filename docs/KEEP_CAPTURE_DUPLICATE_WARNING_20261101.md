# KEEP ALIGNER — Aviso sobre capturas repetidas (ensaio)

O preflight acrescenta `possibleRepeatedCaptures` e `duplicateCaptureHashes` ao relatório de integridade. Compara hashes SHA-256 de capturas distintas, depois de confirmar integridade dos ficheiros, e sinaliza conteúdo exatamente igual em nomes de ficheiro diferentes.

O aviso **não constitui aprovação ou reprovação clínica**. O conteúdo visual semelhante pode ser legítimo, e capturas diferentes podem conter o mesmo enquadramento com metadados distintos. A verificação não deteta imagens visualmente iguais após recompressão/edição, nem confirma vista, orientação, contactos oclusais desligados ou correção do tratamento.

Os indicadores não autorizam publicar, arquivar, recolher dados de My Keep/Hirsch/Onyx, nem dispensam a revisão visual e clínica humana. A propriedade `ok` mantém o significado de conformidade estrutural e integridade, não de aprovação visual.

Testes de desenvolvimento: `python -m unittest discover -s tests -p "test_*.py" -v`, com fixtures exclusivamente sintéticas. Não instalar a alteração no executor em produção antes da validação do fluxo completo.
