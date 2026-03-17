export interface SupplierPartner {
  id: string;
  name: string;
  country: string;
  type: string;
  contactEmail: string;
  responseTime: string;
  logoInitials: string;
  verified: boolean;
}

export const PARTNERS: SupplierPartner[] = [
  {
    id: "barwon-au",
    name: "Barwon Pharma",
    country: "AU",
    type: "Wholesale distributor",
    contactEmail: "suppliers@mederti.com",
    responseTime: "4 business hours",
    logoInitials: "BP",
    verified: true,
  },
  {
    id: "alliance-gb",
    name: "Alliance Healthcare",
    country: "GB",
    type: "Wholesale distributor",
    contactEmail: "suppliers@mederti.com",
    responseTime: "4 business hours",
    logoInitials: "AH",
    verified: true,
  },
];

export function getPartnerForCountry(country: string): SupplierPartner | null {
  return PARTNERS.find(p => p.country === country) ?? null;
}
