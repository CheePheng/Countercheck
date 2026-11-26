const STEPS: [string, string][] = [
  [
    "A model reads the invoice once",
    "Gemma 4 on Cloudflare Workers AI gets the invoice's text and returns every field with a quote copied from the page. It is told to report what the invoice says, even when it looks wrong.",
  ],
  [
    "Code checks every quote",
    "Each quote has to be on the page, and each value has to be in its quote. A value that fails is marked, and the invoice goes to a person. This is what stops an invented PO number or a misread total.",
  ],
  [
    "Code checks the invoice",
    "Plain rules compare it with the vendor list, the purchase order, the deliveries and the invoices already paid: prices, quantities, units, currency, tax and sums, duplicates, and bank details that changed.",
  ],
  [
    "A person decides",
    "Countercheck only recommends. Approving, holding or rejecting is a click by the reviewer, with the reasons in plain words and the evidence highlighted on the invoice.",
  ],
];

export function How() {
  return (
    <article className="paper mx-auto max-w-[48rem] px-5 py-6 sm:px-8 sm:py-8">
      <h1 className="text-[2rem] leading-tight font-[800]">How it works</h1>
      <p className="mt-3 text-ink-soft">
        Countercheck is an open-source accounts-payable assistant. These invoices, vendors and banks
        are invented for the demo.
      </p>
      <ol className="mt-6 space-y-5">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="grid grid-cols-[2rem_1fr] gap-2">
            <span className="text-[1.4rem] leading-none font-[800] text-rule">{i + 1}</span>
            <div>
              <h2 className="text-[1.1rem] font-[750]">{title}</h2>
              <p className="mt-1 text-ink-soft">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <section className="double-rule mt-8 pt-4">
        <h2 className="text-[1.2rem] font-[750]">Why one model call, not an agent</h2>
        <p className="mt-2 text-ink-soft">
          Checking an invoice is a known procedure, so it is written as code: cheaper, faster, and
          the same answer every time. The model does the one thing code can't, reading invoices in
          any layout or language. One reading costs about 30 neurons of Workers AI's free daily
          allowance.
        </p>
      </section>
      <section className="double-rule mt-6 pt-4">
        <h2 className="text-[1.2rem] font-[750]">What's stored</h2>
        <p className="mt-2 text-ink-soft">
          Nothing you do here is saved. Live readings are counted per network with a key that
          changes every day, so no IP address is kept.
        </p>
      </section>
    </article>
  );
}
