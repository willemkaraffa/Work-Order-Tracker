"""
Unit tests for sync_to_lookup.map_to_service_item.

Run from the project root:
    python -m unittest tests/test_mapping.py -v
"""
import sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sync_to_lookup import map_to_service_item


SERVICE_ITEMS = [
    {"name": "Labor!",                 "desc": "fallback labor",      "price": 0.0},
    {"name": "Materials!",             "desc": "fallback materials",  "price": 0.0},
    {"name": "Condensate Pump",        "desc": "condensate pump",     "price": 185.0},
    {"name": "Drain Clear",            "desc": "drain line clearing", "price": 150.0},
    {"name": "Thermostat - Honeywell", "desc": "honeywell thermostat","price": 220.0},
]


class MappingTests(unittest.TestCase):

    def test_exact_match_wins(self):
        self.assertEqual(
            map_to_service_item("Condensate Pump", 0, SERVICE_ITEMS),
            "Condensate Pump",
        )

    def test_jaccard_match(self):
        self.assertEqual(
            map_to_service_item("Drain line clearing service", 0, SERVICE_ITEMS),
            "Drain Clear",
        )

    def test_price_boost_disambiguates(self):
        result = map_to_service_item("pump replacement", 180.0, SERVICE_ITEMS)
        self.assertEqual(result, "Condensate Pump")

    def test_labor_fallback(self):
        # No service item match -> keyword fallback. "diagnos" matches "diagnose".
        self.assertEqual(
            map_to_service_item("diagnose noise from unfamiliar gadget", 0, SERVICE_ITEMS),
            "Labor!",
        )

    def test_materials_fallback(self):
        self.assertEqual(
            map_to_service_item("Replacement filter cartridge", 0, SERVICE_ITEMS),
            "Materials!",
        )

    def test_override_wins_over_match(self):
        overrides = {"condensate pump": "Custom Override Name"}
        self.assertEqual(
            map_to_service_item("Condensate Pump", 0, SERVICE_ITEMS, overrides),
            "Custom Override Name",
        )

    def test_override_case_insensitive_and_trimmed(self):
        overrides = {"freon top-off": "Refrigerant Charge"}
        self.assertEqual(
            map_to_service_item("  Freon Top-Off  ", 0, SERVICE_ITEMS, overrides),
            "Refrigerant Charge",
        )

    def test_empty_service_items_returns_labor(self):
        self.assertEqual(map_to_service_item("clean drain", 0, []), "Labor!")

    def test_default_when_nothing_matches(self):
        # No keyword hits at all -> defaults to Labor!
        self.assertEqual(
            map_to_service_item("xyzzy", 0, SERVICE_ITEMS),
            "Labor!",
        )


if __name__ == "__main__":
    unittest.main()
