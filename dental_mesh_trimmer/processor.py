"""
Core processing library for automated dental 3D mesh trimming and cleaning.
"""

import os
import trimesh
import numpy as np


class DentalMeshProcessor:
    """
    Handles cleaning, trimming, auto-alignment, and base creation for 3D intraoral dental scan models.
    Preserves exact tooth dimensions and anatomical geometry.
    """

    def __init__(self, mesh):
        """
        Initialize processor with a trimesh object or Scene.
        """
        if isinstance(mesh, trimesh.Scene):
            meshes = [g for g in mesh.geometry.values() if isinstance(g, trimesh.Trimesh)]
            if meshes:
                mesh = trimesh.util.concatenate(meshes)
            else:
                raise ValueError("Nenhum modelo 3D válido foi encontrado no arquivo.")
        elif not isinstance(mesh, trimesh.Trimesh):
            raise ValueError(f"Tipo de objeto 3D inválido: {type(mesh)}")

        self.mesh = mesh.copy()

    @classmethod
    def from_file(cls, filepath: str) -> "DentalMeshProcessor":
        """Load 3D mesh from STL, OBJ, or PLY file with robust fallback options."""
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Arquivo não encontrado: {filepath}")

        try:
            loaded = trimesh.load(filepath, force='mesh')
        except Exception:
            try:
                loaded = trimesh.load(filepath)
            except Exception as e:
                raise ValueError(f"Não foi possível ler o arquivo 3D ({os.path.basename(filepath)}): {str(e)}")

        return cls(loaded)

    def align_to_occlusal_plane(self) -> trimesh.Trimesh:
        """
        Aligns the dental mesh using Principal Component Analysis (PCA)
        so that the main arch plane lies on XY and height variation is along Z.
        """
        if len(self.mesh.vertices) < 3:
            return self.mesh

        try:
            vertices = self.mesh.vertices
            centroid = vertices.mean(axis=0)
            centered = vertices - centroid

            # PCA via SVD / Covariance
            cov = np.cov(centered.T)
            eigenvalues, eigenvectors = np.linalg.eigh(cov)

            # Sort components by variance (ascending: smallest variance is depth/height normal)
            order = np.argsort(eigenvalues)
            eigenvectors = eigenvectors[:, order]

            # Construct rotation matrix so 3rd principal component (smallest variance) aligns with Z
            rot_matrix = np.eye(4)
            rot_matrix[:3, :3] = eigenvectors.T

            self.mesh.apply_transform(rot_matrix)

            # Ensure teeth point upwards (+Z) if necessary by examining bounding box
            z_vals = self.mesh.vertices[:, 2]
            if np.median(z_vals) > np.mean(z_vals):
                flip_z = np.eye(4)
                flip_z[2, 2] = -1.0
                self.mesh.apply_transform(flip_z)
        except Exception:
            pass

        return self.mesh

    def remove_floating_artifacts(self, min_relative_area: float = 0.05) -> trimesh.Trimesh:
        """
        Removes disconnected floating components (e.g. cheek/tongue artifacts, isolated scan noise).
        """
        try:
            components = self.mesh.split(only_watertight=False)
            if len(components) <= 1:
                return self.mesh

            areas = [comp.area for comp in components]
            max_area = max(areas) if areas else 0

            if max_area > 0:
                valid_components = [
                    comp for comp, area in zip(components, areas)
                    if (area / max_area) >= min_relative_area
                ]
                if valid_components:
                    self.mesh = trimesh.util.concatenate(valid_components)
        except Exception:
            pass

        return self.mesh

    def trim_by_plane(self, plane_origin: np.ndarray = None, plane_normal: np.ndarray = None, height_percentile: float = 20.0) -> trimesh.Trimesh:
        """
        Trims soft tissue / excess gingiva below a specified cutting plane.
        Features ultra-robust fallback using pure vertex/face filtering if slice_mesh_plane encounters non-manifold geometry.
        """
        if len(self.mesh.vertices) == 0:
            return self.mesh

        if plane_normal is None:
            plane_normal = np.array([0.0, 0.0, 1.0])
        else:
            plane_normal = np.array(plane_normal, dtype=float)
            norm = np.linalg.norm(plane_normal)
            if norm > 0:
                plane_normal = plane_normal / norm
            else:
                plane_normal = np.array([0.0, 0.0, 1.0])

        if plane_origin is None:
            z_vals = self.mesh.vertices[:, 2]
            z_cut = np.percentile(z_vals, height_percentile)
            plane_origin = np.array([0.0, 0.0, z_cut])
        else:
            plane_origin = np.array(plane_origin, dtype=float)

        # Primary attempt: trimesh.intersections.slice_mesh_plane
        try:
            sliced = trimesh.intersections.slice_mesh_plane(
                mesh=self.mesh,
                plane_origin=plane_origin,
                plane_normal=plane_normal,
                cap=False
            )
            if len(sliced.vertices) > 0:
                self.mesh = sliced
                return self.mesh
        except Exception:
            pass

        # Robust Fallback: Filter faces whose centroids lie above/in front of the cut plane
        try:
            face_centroids = self.mesh.triangles.mean(axis=1)
            # Dot product with plane_normal relative to plane_origin
            dots = np.dot(face_centroids - plane_origin, plane_normal)
            valid_face_mask = dots >= 0

            if np.any(valid_face_mask):
                submesh = self.mesh.submesh([valid_face_mask], append=True)
                if len(submesh.vertices) > 0:
                    self.mesh = submesh
        except Exception:
            pass

        return self.mesh

    def add_flat_base(self, base_z: float = None) -> trimesh.Trimesh:
        """
        Caps open boundaries and repairs holes to create a solid printable model.
        """
        try:
            trimesh.repair.fix_winding(self.mesh)
            trimesh.repair.fix_inversion(self.mesh)
            trimesh.repair.fill_holes(self.mesh)
        except Exception:
            pass

        return self.mesh

    def process(
        self,
        min_artifact_ratio: float = 0.05,
        cut_height_percentile: float = 20.0,
        plane_origin: list = None,
        plane_normal: list = None,
        create_base: bool = True,
        auto_align: bool = False
    ) -> trimesh.Trimesh:
        """
        Executes complete automated workflow:
        1. Auto-align scan orientation to principal occlusal axes (optional)
        2. Clean floating artifacts/debris
        3. Plane cut soft tissue
        4. Cap base (if enabled)
        """
        if auto_align and plane_origin is None and plane_normal is None:
            self.align_to_occlusal_plane()

        self.remove_floating_artifacts(min_relative_area=min_artifact_ratio)

        self.trim_by_plane(
            plane_origin=plane_origin,
            plane_normal=plane_normal,
            height_percentile=cut_height_percentile
        )

        if create_base:
            self.add_flat_base()

        return self.mesh

    def save(self, output_filepath: str):
        """Save processed mesh to STL/OBJ/PLY file."""
        os.makedirs(os.path.dirname(os.path.abspath(output_filepath)), exist_ok=True)
        ext = os.path.splitext(output_filepath)[1].lower().replace('.', '')
        if ext in ['stl', 'ply', 'obj']:
            self.mesh.export(output_filepath, file_type=ext)
        else:
            self.mesh.export(output_filepath)
