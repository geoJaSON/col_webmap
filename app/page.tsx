import Workspace from "@/components/Workspace";
import { listApplications, storeMode } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const applications = await listApplications();
  return <Workspace initialApplications={applications} mode={storeMode()} />;
}
