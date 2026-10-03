"""
Command-line interface for dental 3D mesh trimming and batch processing.
"""

import os
import glob
import argparse
from dental_mesh_trimmer.processor import DentalMeshProcessor


def process_single_file(
    input_file: str,
    output_file: str,
    cut_percentile: float,
    min_artifact_ratio: float,
    create_base: bool,
    auto_align: bool
):
    print(f"Processing: {input_file} -> {output_file}")
    processor = DentalMeshProcessor.from_file(input_file)
    processor.process(
        min_artifact_ratio=min_artifact_ratio,
        cut_height_percentile=cut_percentile,
        create_base=create_base,
        auto_align=auto_align
    )
    processor.save(output_file)
    print(f"Successfully saved: {output_file}")


def main():
    parser = argparse.ArgumentParser(
        description="Automated 3D Dental Mesh Trimmer and Soft Tissue Cleaner."
    )
    parser.add_argument(
        "-i", "--input", required=True,
        help="Input file path (.stl, .obj, .ply) OR directory containing 3D files for batch processing."
    )
    parser.add_argument(
        "-o", "--output", required=True,
        help="Output file path OR output directory (when batch processing)."
    )
    parser.add_argument(
        "--cut-percentile", type=float, default=20.0,
        help="Height percentile (0 to 100) along Z-axis below which soft tissue is cut (default: 20)."
    )
    parser.add_argument(
        "--min-artifact-ratio", type=float, default=0.05,
        help="Minimum surface area ratio relative to main mesh for keeping isolated components (default: 0.05)."
    )
    parser.add_argument(
        "--no-base", action="store_true",
        help="Disable automatic flat base capping."
    )
    parser.add_argument(
        "--no-auto-align", action="store_true",
        help="Disable automatic PCA alignment to occlusal plane."
    )

    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)

    if os.path.isdir(input_path):
        os.makedirs(output_path, exist_ok=True)
        extensions = ["*.stl", "*.obj", "*.ply", "*.STL", "*.OBJ", "*.PLY"]
        files = []
        for ext in extensions:
            files.extend(glob.glob(os.path.join(input_path, ext)))

        if not files:
            print(f"No 3D mesh files (.stl, .obj, .ply) found in directory: {input_path}")
            return

        print(f"Found {len(files)} 3D file(s) for batch processing in {input_path}")
        for filepath in files:
            filename = os.path.basename(filepath)
            out_filepath = os.path.join(output_path, f"trimmed_{filename}")
            try:
                process_single_file(
                    filepath,
                    out_filepath,
                    args.cut_percentile,
                    args.min_artifact_ratio,
                    create_base=not args.no_base,
                    auto_align=not args.no_auto_align
                )
            except Exception as e:
                print(f"Error processing {filename}: {e}")
    else:
        if os.path.isdir(output_path):
            filename = os.path.basename(input_path)
            output_file = os.path.join(output_path, f"trimmed_{filename}")
        else:
            output_file = output_path

        process_single_file(
            input_path,
            output_file,
            args.cut_percentile,
            args.min_artifact_ratio,
            create_base=not args.no_base,
            auto_align=not args.no_auto_align
        )


if __name__ == "__main__":
    main()
