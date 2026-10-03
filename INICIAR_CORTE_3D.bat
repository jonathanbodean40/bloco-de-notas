@echo off
title Cortador e Limpador de Modelos 3D Dentarios
echo =======================================================
echo Instalando/Atualizando dependencias necessarias...
echo =======================================================

python -m pip install trimesh numpy scipy shapely flask --quiet
python -m pip install -e . --quiet

echo =======================================================
echo Iniciando o Cortador de Modelos 3D Dentarios...
echo Por favor, aguarde a janela do navegador abrir automaticamente.
echo =======================================================

python -m dental_mesh_trimmer.web_app

pause
