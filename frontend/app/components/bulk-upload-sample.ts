export const SAMPLE_CSV = `Description,Vendor Name,Qty Ordered,Qty Backordered
ALPHAPHARM AMOXICILLIN CAP 500MG,Alphapharm,500,0
SANDOZ METFORMIN TAB 850MG,Sandoz,200,50
HOSPIRA CISPLATIN INJ 1MG/ML 50ML,Hospira,30,30
FRESENIUS PARACETAMOL IV INF 10MG/ML,Fresenius Kabi,100,25
PFIZER ATORVASTATIN TAB 40MG,Pfizer,300,0
GSK SALBUTAMOL INH 100MCG 200DOSE,GlaxoSmithKline,150,0
ASPEN LITHIUM CARB TAB 250MG,Aspen Pharmacare,75,10
ASTRAZENECA OMEPRAZOLE CAP 20MG,AstraZeneca,400,0
SANOFI INSULIN GLARGINE SOLOSTAR,Sanofi,80,15
SANOFI ENOXAPARIN INJ 40MG/0.4ML,Sanofi,120,0`;

export function downloadSampleCSV() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mederti-sample-procurement.csv";
  a.click();
  URL.revokeObjectURL(url);
}
