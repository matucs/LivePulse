import { MatchDetailClient } from "@/components/MatchDetailClient";

export default async function MatchPage(props: PageProps<"/match/[id]">) {
  const { id } = await props.params;
  return <MatchDetailClient matchId={id} />;
}
