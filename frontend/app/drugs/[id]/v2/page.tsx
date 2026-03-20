import { redirect } from "next/navigation";

interface Props { params: Promise<{ id: string }> }

export default async function V2DrugPage({ params }: Props) {
  const { id } = await params;
  redirect(`/drugs/${id}`);
}
