"""
Unit and integration tests for dental_mesh_trimmer.
"""

import os
import io
import tempfile
import pytest
import numpy as np
import trimesh

from dental_mesh_trimmer.processor import DentalMeshProcessor
from dental_mesh_trimmer.web_app import app


def create_synthetic_dental_mesh():
    """
    Creates a synthetic dental model mesh consisting of:
    1. Main arch mesh (half cylinder / dome representing teeth and gingiva).
    2. Small floating artifact mesh (a small disconnected sphere/cube nearby).
    """
    # Main arch representation: hemisphere / cylinder top
    main_mesh = trimesh.creation.icosphere(subdivisions=3, radius=10.0)
    # Stretch along X and Y to resemble dental arch shape
    main_mesh.vertices[:, 0] *= 1.5
    main_mesh.vertices[:, 1] *= 1.2

    # Small artifact mesh representing soft tissue floating piece
    artifact = trimesh.creation.icosphere(subdivisions=1, radius=1.0)
    artifact.apply_translation([30.0, 30.0, 0.0])  # Disconnected

    combined = trimesh.util.concatenate([main_mesh, artifact])
    return combined, main_mesh, artifact


def test_remove_floating_artifacts():
    combined, main_mesh, artifact = create_synthetic_dental_mesh()

    # Verify initially 2 disconnected components
    split_initial = combined.split(only_watertight=False)
    assert len(split_initial) == 2

    processor = DentalMeshProcessor(combined)
    cleaned = processor.remove_floating_artifacts(min_relative_area=0.05)

    split_after = cleaned.split(only_watertight=False)
    assert len(split_after) == 1
    # Check that vertex count matches main mesh
    assert len(cleaned.vertices) == len(main_mesh.vertices)


def test_trim_by_plane():
    combined, _, _ = create_synthetic_dental_mesh()
    processor = DentalMeshProcessor(combined)

    initial_z_min = processor.mesh.bounds[0][2]
    initial_z_max = processor.mesh.bounds[1][2]

    # Trim lower 30% along Z axis
    processor.trim_by_plane(height_percentile=30.0)

    new_z_min = processor.mesh.bounds[0][2]
    new_z_max = processor.mesh.bounds[1][2]

    assert new_z_min > initial_z_min
    assert np.isclose(new_z_max, initial_z_max, atol=1e-3)


def test_dimensional_preservation():
    """
    Critical requirement: Verify that dental tooth geometry in retained region
    has 100% exact dimensional accuracy (zero scale/distortion).
    """
    combined, _, _ = create_synthetic_dental_mesh()
    processor = DentalMeshProcessor(combined)

    # Get upper region vertices (crown region)
    upper_mask = processor.mesh.vertices[:, 2] > 5.0
    original_upper_coords = processor.mesh.vertices[upper_mask].copy()

    processor.process(
        min_artifact_ratio=0.05,
        cut_height_percentile=10.0,
        create_base=False
    )

    # Find the same upper vertices in processed mesh
    # Coordinates for upper vertices must remain identical
    for pt in original_upper_coords:
        # Distance to nearest vertex in processed mesh should be 0.0
        dists = np.linalg.norm(processor.mesh.vertices - pt, axis=1)
        assert np.min(dists) < 1e-6, f"Vertex position altered! Min dist: {np.min(dists)}"


def test_cli_execution():
    combined, _, _ = create_synthetic_dental_mesh()

    with tempfile.TemporaryDirectory() as tmpdir:
        input_file = os.path.join(tmpdir, "test_input.stl")
        output_file = os.path.join(tmpdir, "test_output.stl")

        combined.export(input_file)

        cmd = f"dental-trimmer -i {input_file} -o {output_file} --cut-percentile 25"
        ret = os.system(cmd)
        assert ret == 0
        assert os.path.exists(output_file)

        loaded = trimesh.load_mesh(output_file)
        assert len(loaded.vertices) > 0


def test_web_app_upload():
    combined, _, _ = create_synthetic_dental_mesh()
    stl_bytes = io.BytesIO()
    combined.export(stl_bytes, file_type='stl')
    stl_bytes.seek(0)

    client = app.test_client()
    data = {
        'files': (stl_bytes, 'test_mesh.stl'),
        'cut_percentile': '20',
        'create_base': 'true'
    }

    response = client.post('/process', data=data, content_type='multipart/form-data')
    assert response.status_code == 200
    assert len(response.data) > 0
