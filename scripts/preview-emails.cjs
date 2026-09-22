// Local-only preview using real handlers and a temporary PostgreSQL fixture.
// The fixture intercepts all provider/database traffic; no live emails are sent.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { harness } = require('../tests/fixtures/email-campaign-harness.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const fixture = await harness();
  await fixture.call('sync');
  await fixture.db.exec(`update email_contacts set marketing_status='subscribed',consent_note='Synthetic preview consent' where email='alex@example.com';
    insert into email_contacts(email,first_name,last_name,marketing_status) values
      ('morgan@example.com','Morgan','Williams','subscribed'),('riley@example.com','Riley','Chen','not_subscribed'),('sam@example.com','Sam','Patel','unsubscribed');`);
  await fixture.call('group', { name: 'Tuesday adults', contact_ids: (await fixture.db.query("select id from email_contacts where email in ('morgan@example.com','riley@example.com')")).rows.map((r) => r.id) });
  const bootstrap = `window.KIMS_SUPABASE={url:'fixture',anonKey:'fixture'};
    class Query {select(){return this}eq(){return this}in(){return this}order(){return this}limit(){return this}single(){return Promise.resolve({data:{role:'admin'}})}then(a,b){return Promise.resolve({data:[],count:0}).then(a,b)}}
    window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'${fixture.ADMIN}'},access_token:'fixture-admin'}}})},from:()=>new Query()})};`;
  const allowed = new Set(['styles.css','admin-availability.css','admin-rackets.css','header-cart.css','admin-emails.css','email-campaign-content.js','admin-emails.js','admin-dashboard.js']);
  http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (body) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(body)); };
      res.send = (body) => res.end(body);
      if (url.pathname === '/api/email-campaigns' || url.pathname === '/api/email-unsubscribe') {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 256000) return res.status(413).json({ error: 'Too large' }); }
        req.body = raw || undefined;
        return await require(url.pathname === '/api/email-campaigns' ? '../api/email-campaigns' : '../api/email-unsubscribe')(req,res);
      }
      if (url.pathname === '/' || url.pathname === '/admin.html') {
        const html = fs.readFileSync(path.join(root,'admin.html'),'utf8')
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')
          .replace('<div id="owner-panel" hidden>','<div id="owner-panel">')
          .replace('<p id="owner-status" class="helper-text"></p>','<p id="owner-status" class="helper-text">LOCAL PREVIEW · Sample contacts only. All sending is simulated.</p>')
          .replace('</body>',`<script>${bootstrap}</script><script src="email-campaign-content.js"></script><script src="admin-emails.js"></script><script src="admin-dashboard.js"></script></body>`);
        res.setHeader('Content-Type','text/html'); return res.end(html);
      }
      const file = url.pathname.slice(1);
      if (!allowed.has(file)) { res.statusCode=404; return res.end('Not found'); }
      res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'application/javascript');
      res.end(fs.readFileSync(path.join(root,file)));
    } catch (error) { res.statusCode=500; res.end('Preview error: '+error.message); }
  }).listen(4176,'127.0.0.1',()=>console.log('Email preview: http://127.0.0.1:4176/admin.html#emails'));
})();
