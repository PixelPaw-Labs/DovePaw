import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "generate-electron-icons.py"
SPEC = importlib.util.spec_from_file_location("generate_electron_icons", SCRIPT_PATH)
assert SPEC and SPEC.loader
generate_electron_icons = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generate_electron_icons)


class ValidateDimensionsTest(unittest.TestCase):
    def test_accepts_1024_square_source(self) -> None:
        generate_electron_icons.validate_dimensions(1024, 1024)

    def test_rejects_source_that_would_be_upscaled(self) -> None:
        with self.assertRaisesRegex(ValueError, "at least 1024×1024"):
            generate_electron_icons.validate_dimensions(512, 512)

    def test_rejects_non_square_source(self) -> None:
        with self.assertRaisesRegex(ValueError, "must be square"):
            generate_electron_icons.validate_dimensions(1024, 1200)


if __name__ == "__main__":
    unittest.main()
