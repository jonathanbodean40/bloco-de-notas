#!/bin/bash
echo "======================================================="
echo "Instalando/Atualizando dependências necessárias..."
echo "======================================================="

python3 -m pip install trimesh numpy scipy shapely flask --quiet
python3 -m pip install -e . --quiet

echo "======================================================="
echo "Iniciando o Cortador de Modelos 3D Dentários..."
echo "Por favor, aguarde a janela do navegador abrir automaticamente."
echo "======================================================="

python3 -m dental_mesh_trimmer.web_app
