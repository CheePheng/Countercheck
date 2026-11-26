"""Data shapes, serialised in camelCase to match packages/core/src/types.ts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    def dump(self) -> dict:
        return self.model_dump(by_alias=True, mode="json")


class BankDetails(Model):
    bank_name: str
    account_name: str
    account_number: str


class Vendor(Model):
    id: str
    name: str
    registration_no: str
    country: Literal["MY", "SG"]
    currency: Literal["MYR", "SGD"]
    address: str
    bank: BankDetails


class PoLine(Model):
    line_no: int
    sku: str
    description: str
    quantity: int
    unit: str
    unit_price: float


class PurchaseOrder(Model):
    number: str
    vendor_id: str
    date: str
    currency: Literal["MYR", "SGD"]
    tax_rate: float
    lines: list[PoLine]


class ReceiptLine(Model):
    sku: str
    quantity: int
    unit: str


class GoodsReceipt(Model):
    number: str
    po_number: str
    date: str
    lines: list[ReceiptLine]


class LedgerLine(Model):
    sku: str
    quantity: int


class LedgerEntry(Model):
    vendor_id: str
    invoice_number: str
    invoice_date: str
    total: float
    currency: Literal["MYR", "SGD"]
    po_number: str | None
    lines: list[LedgerLine]
    posted_on: str


class Buyer(Model):
    name: str
    registration_no: str
    address: str


class World(Model):
    buyer: Buyer
    vendors: list[Vendor]
    purchase_orders: list[PurchaseOrder]
    goods_receipts: list[GoodsReceipt]
    ledger: list[LedgerEntry]


class InvoiceLine(Model):
    description: str
    sku: str | None
    quantity: float
    unit: str
    unit_price: float
    amount: float


class Invoice(Model):
    vendor_name: str
    vendor_registration_no: str | None
    invoice_number: str
    invoice_date: str
    po_number: str | None
    currency: str
    lines: list[InvoiceLine]
    subtotal: float
    tax_rate: float | None
    tax: float
    total: float
    bank: BankDetails | None


Decision = Literal["approve", "hold", "reject"]


class Truth(Model):
    """The known answer for one sample invoice. Never sent to the model."""

    id: str
    situation: str
    invoice: Invoice
    decision: Decision
    reasons: list[str]


class CaseInfo(Model):
    """What the app and the evals may know about a sample invoice before checking it."""

    id: str
    split: Literal["dev", "test"]
    layout: str
    pdf: str
    image: str
    page: str
