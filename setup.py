from setuptools import setup, find_packages

setup(
    name="dental_mesh_trimmer",
    version="1.0.0",
    description="Automated 3D dental mesh trimming, artifact removal, and base creation",
    author="Jules",
    packages=find_packages(),
    install_requires=[
        "trimesh",
        "numpy",
        "scipy",
        "shapely"
    ],
    entry_points={
        "console_scripts": [
            "dental-trimmer=dental_mesh_trimmer.cli:main",
        ],
    },
    python_requires=">=3.8",
)
