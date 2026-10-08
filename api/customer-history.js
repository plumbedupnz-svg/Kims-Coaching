const h = require('./stripe/_helpers');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const user = await h.verifyUser(req.headers.authorization || '');
    if (!user.email_confirmed_at) return res.status(403).json({ error: 'Verify your email before viewing account history.' });
    // Always use the verified session identity, never an email or customer ID from the request.
    const orders = await h.restSelect('shop_orders', 'id,order_reference,created_at,items,total_amount,payment_status,fulfilment_status', { user_id: `eq.${user.id}`, order: 'created_at.desc', limit: '100' });
    const rackets = await h.restSelect('customer_rackets', 'id,player_name,racket_type', { customer_id: `eq.${user.id}`, order: 'created_at.desc' });
    const stringings = rackets.length ? await h.restSelect('racket_stringings', 'id,racket_id,strung_on,strings_main,strings_cross,tension_main,tension_cross,tension_unit', { racket_id: h.uuidList(rackets.map(r => r.id)), order: 'strung_on.desc,created_at.desc' }) : [];
    return res.status(200).json({ orders, rackets: rackets.map(r => ({ ...r, stringings: stringings.filter(s => s.racket_id === r.id) })) });
  } catch (error) {
    console.error('[Customer history]', error.message);
    return res.status(400).json({ error: 'Could not load account history. Please sign in again or contact Kim.' });
  }
};
