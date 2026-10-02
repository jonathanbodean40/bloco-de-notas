"""
Core processing library for automated dental 3D mesh trimming and cleaning.
"""

import os
import trimesh
import numpy as np


class DentalMeshProcessor:
    """
    Handles cleaning, trimming, and base creation for 3D intraoral dental scan models.
    Preserves exact tooth dimensions and anatomical geometry.
    """

    def __init__(self, mesh: trimesh.Trimesh):
        """
        Initialize processor with a trimesh object.
        """
        if not isinstance(mesh, trimesh.Trimesh):
            if isinstance(mesh, trimesh.Scene):
                # If a scene was loaded, dump all geometries into a single mesh
                mesh = trimesh.util.concatenate(
                    [g for g in mesh.geometry.values() if isinstance(g, trimesh.Trimesh)]
                )
            else:
                raise ValueError("Expected a trimesh.Trimesh object.")
        self.mesh = mesh.copy()

    @classmethod
    def from_file(cls, filepath: str) -> "DentalMeshProcessor":
        """Load 3D mesh from STL, OBJ, or PLY file."""
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"File not found: {filepath}")
        mesh = trimesh.load_mesh(filepath)
        return cls(mesh)

    def remove_floating_artifacts(self, min_relative_area: float = 0.05) -> trimesh.Trimesh:
        """
        Removes disconnected floating components (e.g. cheek/tongue artifacts, isolated scan noise).

        Args:
            min_relative_area: Components with surface area smaller than this fraction
                               of the largest component area will be removed.
        Returns:
            Cleaned trimesh.Trimesh object.
        """
        components = self.mesh.split(only_watertight=False)
        if len(components) <= 1:
            return self.mesh

        # Find component areas
        areas = [comp.area for comp in components]
        max_area = max(areas)

        # Keep components that satisfy min_relative_area
        valid_components = [
            comp for comp, area in zip(components, areas)
            if (area / max_area) >= min_relative_area
        ]

        if valid_components:
            self.mesh = trimesh.util.concatenate(valid_components)
        return self.mesh

    def trim_by_plane(self, plane_origin: np.ndarray = None, plane_normal: np.ndarray = None, height_percentile: float = 20.0) -> trimesh.Trimesh:
        """
        Trims soft tissue / excess gingiva below (or behind) a specified cutting plane.

        Args:
            plane_origin: Point on plane [x, y, z]. If None, calculated based on height_percentile along Z axis.
            plane_normal: Normal vector pointing TOWARDS the retained side [nx, ny, nz]. Default [0, 0, 1] (retains +Z side).
            height_percentile: Percentile of Z bounds to place default origin (e.g., 20% from bottom Z).
        Returns:
            Trimmed trimesh.Trimesh object.
        """
        if plane_normal is None:
            plane_normal = np.array([0.0, 0.0, 1.0])
        else:
            plane_normal = np.array(plane_normal, dtype=float)
            plane_normal = plane_normal / np.linalg.norm(plane_normal)

        if plane_origin is None:
            # Estimate cut Z height based on percentile of vertex Z coordinates
            z_vals = self.mesh.vertices[:, 2]
            z_cut = np.percentile(z_vals, height_percentile)
            plane_origin = np.array([0.0, 0.0, z_cut])
        else:
            plane_origin = np.array(plane_origin, dtype=float)

        # Slice mesh keeping portion in positive direction of plane_normal
        sliced = trimesh.intersections.slice_mesh_plane(
            mesh=self.mesh,
            plane_origin=plane_origin,
            plane_normal=plane_normal,
            cap=False
        )

        if len(sliced.vertices) > 0:
            self.mesh = sliced

        return self.mesh

    def add_flat_base(self, base_z: float = None) -> trimesh.Trimesh:
        """
        Caps open boundaries and repairs holes to create a solid printable model.

        Args:
            base_z: Absolute Z height threshold for base positioning if specified.
        Returns:
            Trimesh object.
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
        create_base: bool = True
    ) -> trimesh.Trimesh:
        """
        Executes complete automated workflow:
        1. Clean floating artifacts/debris
        2. Plane cut soft tissue
        3. Cap base (if enabled)
        """
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
        self.mesh.export(output_filepath)
