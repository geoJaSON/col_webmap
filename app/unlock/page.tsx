export const dynamic = "force-dynamic";

export default async function Unlock({
  searchParams,
}: {
  searchParams: Promise<{ wrong?: string }>;
}) {
  const { wrong } = await searchParams;

  return (
    <main className="gate">
      {/* A plain form post, so this works before any JavaScript loads. */}
      <form className="gate__card" method="post" action="/api/unlock">
        <h1 className="gate__title">COL Status</h1>
        <p className="gate__blurb">
          TPWD Certificate of Location applications.
        </p>

        <label className="eyebrow gate__label" htmlFor="passcode">
          Passcode
        </label>
        <input
          id="passcode"
          className="gate__input"
          type="password"
          name="passcode"
          autoComplete="current-password"
          autoFocus
          required
        />

        {wrong && <p className="gate__error">That passcode does not match. Try again.</p>}

        <button className="gate__submit" type="submit">
          Open map
        </button>
      </form>
    </main>
  );
}
