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

// Mederti-as-broker fallback. Used by the live drug page's "Find a supplier"
// CTA, which is universal (every country) rather than gated to the AU/GB
// wholesale partners. When no local partner exists we route the request to
// the Mederti sourcing team, who source it on the buyer's behalf. Display
// only — the actual recipient inbox is resolved server-side from env in
// /api/supplier-enquiry.
export const MEDERTI_BROKER: SupplierPartner = {
  id: "mederti",
  name: "Mederti",
  country: "*",
  type: "Sourcing team",
  contactEmail: "suppliers@mederti.com",
  responseTime: "1 business day",
  logoInitials: "M",
  verified: false,
};
