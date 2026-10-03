@echo off
title Cortador e Limpador de Modelos 3D Dentarios
echo =======================================================
echo Iniciando o Cortador de Modelos 3D Dentarios...
echo Por favor, aguarde a janela do navegador abrir automaticamente.
echo =======================================================

python -m pip install -e . >nul 2>&1
python -m dental_mesh_trimmer.web_app

pause
