
export const TAGS = [
  { tag: '#INVOICE#', description: 'Random Invoice (e.g. POWFG-4566-PO)' },
  { tag: '#NUMBER#', description: '12-15 Digit Number' },
  { tag: '#SNUMBER#', description: 'Short Number (5 digits)' },
  { tag: '#LETTERS#', description: '12-15 Random Letters' },
  { tag: '#RANDOM#', description: 'Alphanumeric String' },
  { tag: '#EMAIL#', description: 'Recipient Email' },
  { tag: '#DATE#', description: 'Randomized Date Formats' },
  { tag: '#REGARDS#', description: 'Random Sender Regards' },
  { tag: '#ADDRESS#', description: 'Sender Address' },
  { tag: '#ADDRESS1#', description: 'Sender Address Line 1' },
  { tag: '#ADDRESS2#', description: 'Random Address Line 2' },
  { tag: '#NAME#', description: 'Sender Name' },
  { tag: '#TIME#', description: 'Current/Random Time' },
  { tag: '#AMOUNT#', description: 'Random Amount (200-600)' },
  { tag: '#GUID#', description: 'Random GUID/UUID' },
  { tag: '#KEY#', description: 'Random Security Key' },
  { tag: '#SENDERNAME#', description: 'Sender Name from JSON' },
  { tag: '#TFN#', description: 'Toll Free Number (from UI)' },
  { tag: '#ORDERID#', description: 'Random Order ID (ORD-XXXX)' },
];

export function generateTagValue(tag: string, recipientEmail: string = ''): string {
  const randomStr = (len: number) => Math.random().toString(36).substring(2, 2 + len).toUpperCase();
  const randomNum = (len: number) => Math.floor(Math.pow(10, len-1) + Math.random() * 9 * Math.pow(10, len-1)).toString();
  
  const names = ['Alex John', 'Sarah Connor', 'Michael Smith', 'Emma Wilson', 'James Bond', 'Robert Brown', 'Linda Davis'];
  const addresses = ['1925 Mill Street Greenville, SC 29607', '13622 Paradise Church Rd', 'Catonsville, MD, 21228', 'Magnolia, NJ, 8049', '789 Oak Lane, Austin, TX'];

  switch (tag.toUpperCase()) {
    case '#INVOICE#':
      return Math.random() > 0.5 ? `${randomStr(5)}-${randomNum(4)}-PO` : `${randomNum(5)}-${randomStr(4)}-${randomNum(2)}/`;
    case '#NUMBER#':
      return randomNum(12 + Math.floor(Math.random() * 4));
    case '#SNUMBER#':
      return randomNum(5);
    case '#NAME#':
    case '#REGARDS#':
    case '#SENDERNAME#':
      return names[Math.floor(Math.random() * names.length)];
    case '#LETTERS#':
      return randomStr(12 + Math.floor(Math.random() * 4));
    case '#RANDOM#':
      return randomStr(12);
    case '#EMAIL#':
      return recipientEmail || 'client@example.com';
    case '#DATE#': {
      const d = new Date();
      const formats = [
        d.toLocaleDateString(),
        d.toDateString(),
        `${d.getDate()}-${d.getMonth()+1}-${d.getFullYear()}`,
        `${d.toLocaleString('default', { month: 'short' })}, ${d.getDate()} ${d.getFullYear()}`
      ];
      return formats[Math.floor(Math.random() * formats.length)];
    }
    case '#ADDRESS#':
    case '#ADDRESS1#':
    case '#ADDRESS2#':
      return addresses[Math.floor(Math.random() * addresses.length)];
    case '#TIME#':
      return new Date().toLocaleTimeString();
    case '#AMOUNT#':
      return (200 + Math.random() * 400).toFixed(2);
    case '#GUID#':
    case '#KEY#':
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    case '#ORDERID#':
      return `ORD-${randomStr(8)}`;
    default:
      return tag;
  }
}

export function getTagMap(recipientEmail: string = ''): Record<string, string> {
  const map: Record<string, string> = {};
  TAGS.forEach(t => {
    map[t.tag] = generateTagValue(t.tag, recipientEmail);
  });
  return map;
}

export function replaceTags(text: string, recipientEmail: string = '', overrides: Record<string, string> = {}): string {
  if (!text) return text;
  let result = text;

  // Use a map to ensure consistency if the caller provided one via overrides
  // or we can just apply overrides first as before.
  Object.entries(overrides).forEach(([tag, value]) => {
    if (value && value.trim() !== '') {
      const regex = new RegExp(tag, 'g');
      result = result.replace(regex, value);
    }
  });

  TAGS.forEach(t => {
    const regex = new RegExp(t.tag, 'g');
    if (regex.test(result)) {
      // If the tag is in overrides, it's already handled.
      // Otherwise, generate a value. 
      // NOTE: To ensure consistency between multiple calls (Subject/Body), 
      // the caller should pass the same generated map in overrides.
      result = result.replace(regex, () => generateTagValue(t.tag, recipientEmail));
    }
  });
  return result;
}
