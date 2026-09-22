(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KimsEmailContent = api;
})(typeof window === "object" ? window : this, function () {
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const email = (value) => typeof value === "string" && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
  function parseAddresses(value = '') {
    const tokens = String(value).split(/[\s,;]+/).filter(Boolean);
    const addresses = [], invalid = [], seen = new Set();
    let duplicates = 0;
    for (const token of tokens) {
      const address = token.toLowerCase();
      const [local, domain] = address.split('@');
      const valid = email(address) && !/["()\[\]\\:]/.test(address) && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
        && domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
      if (!valid) invalid.push(token);
      else if (seen.has(address)) duplicates++;
      else { seen.add(address); addresses.push(address); }
    }
    return { addresses, invalid, duplicates, tooMany: addresses.length > 1000 || String(value).length > 100000 };
  }
  const personalize = (value, contact) => String(value || "").replace(/\{\{first_name\}\}/g, contact.first_name || "there");
  const templates = {
    update: { label: "Coaching update", purpose: "service", subject: "An update about your coaching", body: "Hi {{first_name}},\n\nA quick update about your coaching with Kim.\n\n[Add the details here.]\n\nIf you have any questions, just reply to this email.\n\nSee you on court,\nKim" },
    weather: { label: "Weather / session change", purpose: "service", subject: "Coaching session update", body: "Hi {{first_name}},\n\nThere is a change to your upcoming coaching session.\n\nDate and time: [add details]\nChange: [add details]\nNext steps: [add details]\n\nThanks for your understanding. Reply if you have any questions.\n\nKim" },
    newsletter: { label: "News & upcoming programmes", purpose: "marketing", subject: "The latest from Kim Jones Coaching", body: "Hi {{first_name}},\n\nHere is what is coming up at Kim Jones Coaching.\n\n[Add your news, programme details or offer.]\n\nSee you on court,\nKim" }
  };
  function content(campaign, contact = { first_name: "there" }, unsubscribeUrl = "") {
    const subject = personalize(campaign.subject, contact).replace(/[\r\n]/g, " ");
    const body = personalize(campaign.body, contact);
    const preview = personalize(campaign.preview_text, contact);
    const marketing = campaign.purpose === "marketing";
    const footer = marketing ? "You received this because you subscribed to news from Kim Jones Coaching." : "An update about your coaching with Kim Jones Coaching.";
    const link = /^https:\/\//.test(campaign.button_url || "") ? campaign.button_url : "";
    const paragraphs = escape(body).split(/\n\s*\n/).map((p) => `<p style="margin:0 0 20px">${p.replace(/\n/g, "<br>")}</p>`).join("");
    const button = link && campaign.button_label ? `<p style="margin:28px 0"><a href="${escape(link)}" style="display:inline-block;background:#183454;color:#fff;padding:13px 22px;border-radius:6px;text-decoration:none;font-weight:bold">${escape(campaign.button_label)}</a></p>` : "";
    return {
      subject,
      text: `${body}${link ? `\n\n${campaign.button_label || "More details"}: ${link}` : ""}\n\nKim Jones Coaching\n${footer}${marketing && unsubscribeUrl ? `\nUnsubscribe from newsletters: ${unsubscribeUrl}` : ""}`,
      html: `<div style="background:#f3f7fc;padding:28px 12px;font-family:Arial,sans-serif;color:#13213d"><span style="display:none;max-height:0;overflow:hidden">${escape(preview)}</span><div style="max-width:600px;margin:auto;background:white;border:1px solid #dbe3f1;border-radius:10px;overflow:hidden"><div style="padding:26px 32px;border-bottom:3px solid #27adff;font-size:18px;font-weight:bold;letter-spacing:1px">KIM JONES <span style="font-weight:normal">COACHING</span></div><div style="padding:32px;line-height:1.7;font-size:16px">${paragraphs}${button}</div><div style="padding:22px 32px;background:#f7f9fc;font-size:12px;line-height:1.6;color:#5f6f8f">Kim Jones Coaching<br>${escape(footer)}${marketing ? `<br>${unsubscribeUrl ? `<a href="${escape(unsubscribeUrl)}" style="color:#147cc2">Unsubscribe from newsletters</a>` : "Unsubscribe link is added for each recipient."}` : ""}</div></div></div>`
    };
  }
  return { escape, email, parseAddresses, templates, content };
});
