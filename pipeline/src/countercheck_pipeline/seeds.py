"""The invented buyer, vendors and what they sell. Every name, address and bank is made up."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .models import Buyer


@dataclass(frozen=True)
class Item:
    sku: str
    description: str
    unit: str
    price: Decimal
    # For unit-of-measure mix-ups: how many pieces one unit holds ("box of 100").
    pieces: int | None = None


@dataclass(frozen=True)
class VendorSeed:
    id: str
    name: str
    registration_no: str
    country: str  # "MY" or "SG"
    currency: str  # "MYR" or "SGD"
    tax_rate: Decimal
    tax_label: str  # what the invoice calls the tax
    address: tuple[str, ...]
    phone: str
    email: str
    bank_name: str
    account_number: str
    invoice_prefix: str
    accent: str
    items: tuple[Item, ...]


BUYER = Buyer(
    name="Lantern Street Cafés Sdn Bhd",
    registration_no="202001017311 (1375512-K)",
    address="Lot 7, Jalan Contoh 9, Taman Rekaan, 81200 Johor Bahru, Johor",
)

# Banks a vendor may "switch" to in the changed-bank-details cases. Also invented.
OTHER_BANKS = ("Teluk Mutual Bank", "Bank Rekaan Berhad", "Harbourline Savings Bank")

D = Decimal

VENDORS: tuple[VendorSeed, ...] = (
    VendorSeed(
        id="V01",
        name="Orchidfold Packaging Sdn Bhd",
        registration_no="201901012345 (1312345-A)",
        country="MY",
        currency="MYR",
        tax_rate=D("0.10"),
        tax_label="SST",
        address=("Lot 12, Jalan Contoh 3", "Taman Rekaan Industri", "81100 Johor Bahru, Johor"),
        phone="+60 7-555 0142",
        email="accounts@orchidfold.example",
        bank_name="Selatan Commercial Bank",
        account_number="5140-2231-0098",
        invoice_prefix="OF-",
        accent="#7a3e9d",
        items=(
            Item("PKG-CUP-12", "Paper cup 12oz, carton of 1000", "carton", D("185.00"), 1000),
            Item("PKG-LID-12", "Cup lid 12oz, carton of 1000", "carton", D("92.00"), 1000),
            Item("PKG-BAG-M", "Kraft takeaway bag medium, pack of 250", "pack", D("64.50"), 250),
            Item("PKG-STR-6", "Paper straw 6mm, box of 500", "box", D("38.90"), 500),
        ),
    ),
    VendorSeed(
        id="V02",
        name="Serai Fresh Produce Sdn Bhd",
        registration_no="201701034521 (1239876-W)",
        country="MY",
        currency="MYR",
        tax_rate=D("0.00"),
        tax_label="SST",
        address=("No. 4, Lorong Pasar Rekaan", "Jalan Contoh 1", "81300 Skudai, Johor"),
        phone="+60 7-555 0188",
        email="billing@seraifresh.example",
        bank_name="Bank Rekaan Berhad",
        account_number="2207-114-50331",
        invoice_prefix="SFP/",
        accent="#3d7a3a",
        items=(
            Item("FR-BAN", "Bananas, Cavendish", "kg", D("4.20")),
            Item("FR-LEM", "Lemons, imported", "kg", D("7.80")),
            Item("FR-CAL", "Calamansi limes", "kg", D("9.60")),
            Item("HB-PAN", "Pandan leaves, bundle of 20", "pack", D("3.50")),
        ),
    ),
    VendorSeed(
        id="V03",
        name="Tanjung Ferro Hardware Sdn Bhd",
        registration_no="200801023987 (812233-T)",
        country="MY",
        currency="MYR",
        tax_rate=D("0.10"),
        tax_label="SST",
        address=("23, Jalan Contoh Perindustrian 2", "Kawasan Rekaan Tebing", "81700 Pasir Gudang, Johor"),
        phone="+60 7-555 0127",
        email="ar@tanjungferro.example",
        bank_name="Selatan Commercial Bank",
        account_number="5140-8820-1173",
        invoice_prefix="TFH-",
        accent="#b4561f",
        items=(
            Item("HW-BRK-30", "Stainless shelf bracket 30cm", "pcs", D("18.40")),
            Item("HW-ANC-M8", "Wall anchor M8, box of 100", "box", D("26.00"), 100),
            Item("EL-LED-18", "LED tube 18W cool white", "pcs", D("14.90")),
            Item("EL-EXT-5", "Extension cord 5m, 4 sockets", "pcs", D("32.50")),
        ),
    ),
    VendorSeed(
        id="V04",
        name="Brightmoor Cleaning Supplies Sdn Bhd",
        registration_no="201301045566 (1056677-D)",
        country="MY",
        currency="MYR",
        tax_rate=D("0.10"),
        tax_label="SST",
        address=("8, Jalan Contoh Niaga 5", "Pusat Rekaan Komersial", "80200 Johor Bahru, Johor"),
        phone="+60 7-555 0163",
        email="finance@brightmoor.example",
        bank_name="Teluk Mutual Bank",
        account_number="3381-0045-7720",
        invoice_prefix="BM",
        accent="#1f6f8b",
        items=(
            Item("CL-DSH-5L", "Dishwashing liquid 5L", "bottle", D("28.00")),
            Item("CL-FLR-4L", "Floor cleaner 4L, citrus", "bottle", D("24.50")),
            Item("CL-GLV-M", "Nitrile gloves size M, box of 100", "box", D("21.90"), 100),
            Item("CL-MFC-12", "Microfibre cloth, pack of 12", "pack", D("18.00"), 12),
        ),
    ),
    VendorSeed(
        id="V05",
        name="Jalinan Textile Works Sdn Bhd",
        registration_no="201601029911 (1188450-K)",
        country="MY",
        currency="MYR",
        tax_rate=D("0.10"),
        tax_label="SST",
        address=("17, Jalan Contoh Tenun", "Taman Rekaan Jaya", "81300 Skudai, Johor"),
        phone="+60 7-555 0119",
        email="akaun@jalinan.example",
        bank_name="Bank Rekaan Berhad",
        account_number="2207-305-88140",
        invoice_prefix="JTW-",
        accent="#8b2f3c",
        items=(
            Item("TX-APR-OLV", "Barista apron, olive canvas", "pcs", D("45.00")),
            Item("TX-HAT-CHF", "Chef hat, white cotton", "pcs", D("12.50")),
            Item("TX-TWL-6", "Kitchen towel set of 6", "set", D("36.00")),
            Item("TX-OVM-PR", "Oven mitts, heat resistant pair", "set", D("22.00")),
        ),
    ),
    VendorSeed(
        id="V06",
        name="Lumora Kitchenware Pte Ltd",
        registration_no="201812345K",
        country="SG",
        currency="SGD",
        tax_rate=D("0.09"),
        tax_label="GST",
        address=("21 Rekaan Road, #04-12", "Contoh Industrial Building", "Singapore 629999"),
        phone="+65 6555 0174",
        email="ar@lumora.example",
        bank_name="Straits Harbour Bank",
        account_number="771-203344-1",
        invoice_prefix="LK-",
        accent="#2b4c7e",
        items=(
            Item("KW-PAN-28", "Frying pan 28cm, nonstick", "pcs", D("42.50")),
            Item("KW-PIT-600", "Milk pitcher 600ml, steel", "pcs", D("18.90")),
            Item("KW-TMP-58", "Coffee tamper 58mm", "pcs", D("36.00")),
            Item("KW-KNB-L", "Knock box, large", "pcs", D("29.90")),
        ),
    ),
    VendorSeed(
        id="V07",
        name="Quayline Office Supply Pte Ltd",
        registration_no="200912876M",
        country="SG",
        currency="SGD",
        tax_rate=D("0.09"),
        tax_label="GST",
        address=("5 Contoh Quay, #02-30", "Rekaan Business Park", "Singapore 408999"),
        phone="+65 6555 0131",
        email="billing@quayline.example",
        bank_name="Straits Harbour Bank",
        account_number="771-558120-3",
        invoice_prefix="QOS",
        accent="#2f6d5b",
        items=(
            Item("OF-RCP-80", "Thermal receipt roll 80mm, box of 50", "box", D("39.00"), 50),
            Item("OF-A4-500", "A4 copy paper 80gsm, ream of 500", "pack", D("6.90")),
            Item("OF-LBL-12", "Label printer tape 12mm", "roll", D("12.40")),
            Item("OF-MRK-BK", "Permanent marker black, box of 12", "box", D("15.60"), 12),
        ),
    ),
    VendorSeed(
        id="V08",
        name="Sutera Bean Roasters Sdn Bhd",
        registration_no="201401038804 (1098812-P)",
        country="MY",
        currency="MYR",
        tax_rate=D("0.10"),
        tax_label="SST",
        address=("2, Jalan Contoh Kopi", "Taman Rekaan Sutera", "81300 Skudai, Johor"),
        phone="+60 7-555 0155",
        email="orders@suterabean.example",
        bank_name="Teluk Mutual Bank",
        account_number="3381-2290-0416",
        invoice_prefix="SB-",
        accent="#6b4423",
        items=(
            Item("CF-HSE-1K", "House blend coffee beans 1kg", "kg", D("78.00")),
            Item("CF-SGL-1K", "Single origin coffee beans 1kg", "kg", D("96.00")),
            Item("CF-DCF-1K", "Decaf coffee beans 1kg", "kg", D("88.00")),
        ),
    ),
)

VENDOR_BY_ID = {v.id: v for v in VENDORS}
