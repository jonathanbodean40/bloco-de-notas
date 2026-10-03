#!/bin/bash
echo "======================================================="
echo "Iniciando o Cortador de Modelos 3D Dentários..."
echo "Por favor, aguarde a janela do navegador abrir automaticamente."
echo "======================================================="

python3 -m pip install -e . > /dev/null 2>&1
python3 -m dental_mesh_trimmer.web_app
