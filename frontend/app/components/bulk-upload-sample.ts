export const SAMPLE_CSV = `Drug Name,Quantity,Stock Level
Amoxicillin 500mg,500,Low
Metformin 850mg,200,Normal
Cisplatin 1mg/ml,50,Critical
Paracetamol IV 10mg/ml,100,Low
Atorvastatin 40mg,300,Normal
Salbutamol 100mcg Inhaler,150,Normal
Lithium Carbonate 250mg,75,Low
Omeprazole 20mg,400,Normal
Insulin Glargine,80,Normal
Enoxaparin 40mg,120,Normal`;

export function downloadSampleCSV() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mederti-sample-formulary.csv";
  a.click();
  URL.revokeObjectURL(url);
}
