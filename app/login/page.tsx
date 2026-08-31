import LoginForm from "@/app/login/LoginForm";

export const dynamic = "force-dynamic";

/**
 * The only page reachable signed out. Everything else goes through the
 * middleware, which sends people here and remembers where they were headed.
 */
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="gate">
      <div className="gate__card">
        <h1 className="gate__title">COL Status</h1>
        <p className="gate__blurb">
          TPWD Certificate of Location applications and ground samples.
        </p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
