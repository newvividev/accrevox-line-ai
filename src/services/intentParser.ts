export type ParsedQuotationItem = {
  productName: string;
  quantity: number;
  unitPrice: number;
};

export type ParsedQuotationCommand =
  | {
      kind: "create_quotation";
      contactName: string;
      issuedDate: string;
      items: ParsedQuotationItem[];
    }
  | {
      kind: "unsupported";
      reason: string;
    };

function parseItems(rawItems: string): ParsedQuotationItem[] {
  return rawItems
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const csvParts = chunk.split(",").map((value) => value.trim());
      let productName: string | undefined;
      let quantityText: string | undefined;
      let unitPriceText: string | undefined;

      if (csvParts.length >= 3) {
        [productName, quantityText, unitPriceText] = csvParts;
      } else {
        const spacedMatch = chunk.match(
          /^(.+?)\s+(\d+(?:\.\d+)?)\s+(?:ชิ้น|อัน|แท่ง|ตัว|ชุด|เล่ม|แพ็ก|กล่อง|เครื่อง|ครั้ง|ชั่วโมง|หน้า)?\s*(?:ละ|ราคา)?\s*(\d+(?:\.\d+)?)$/
        );
        if (spacedMatch) {
          productName = spacedMatch[1].trim();
          quantityText = spacedMatch[2].trim();
          unitPriceText = spacedMatch[3].trim();
        }
      }

      const quantity = Number(quantityText);
      const unitPrice = Number(unitPriceText);

      if (!productName || Number.isNaN(quantity) || Number.isNaN(unitPrice)) {
        throw new Error(`Invalid item format: ${chunk}`);
      }

      return {
        productName,
        quantity,
        unitPrice
      };
    });
}

export function parseChatCommand(message: string): ParsedQuotationCommand {
  if (!message.includes("ออกใบเสนอราคา")) {
    return {
      kind: "unsupported",
      reason: "ตอนนี้ MVP รองรับเฉพาะคำสั่งออกใบเสนอราคา"
    };
  }

  const contactMatch = message.match(/ลูกค้า=([^\n]+?)(?=\s+\S+=|$)/);
  const dateMatch = message.match(/วันที่=([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  const itemsMatch = message.match(/รายการ=([^\n]+)$/);

  if (!contactMatch || !dateMatch || !itemsMatch) {
    return {
      kind: "unsupported",
      reason: "กรุณาระบุ ลูกค้า=..., วันที่=YYYY-MM-DD และ รายการ=ชื่อสินค้า,จำนวน,ราคา"
    };
  }

  const items = parseItems(itemsMatch[1]);
  if (items.length === 0) {
    return {
      kind: "unsupported",
      reason: "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ"
    };
  }

  return {
    kind: "create_quotation",
    contactName: contactMatch[1].trim(),
    issuedDate: dateMatch[1],
    items
  };
}
