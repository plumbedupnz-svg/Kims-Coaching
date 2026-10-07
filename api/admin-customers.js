const crypto = require('node:crypto');
const h = require('./stripe/_helpers');
const x = require('../lib/xero/client');
const checkout = require('./shop-checkout');

async function authRequest(path, body) {
  const c = h.getSupabaseConfig();
  if (!c.serviceRoleKey) throw new Error('Server credentials are not configured.');
  const response = await fetch(`${c.projectUrl}/auth/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: c.serviceRoleKey, Authorization: `Bearer ${c.serviceRoleKey}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || 'Customer account request failed.');
  return data.user || data;
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  try {
    await x.requireAdmin(req);
    if (req.method === 'GET') {
      const customers = await h.restSelect('profiles', 'id,email,first_name,last_name,phone', { role: 'eq.customer', order: 'first_name.asc,last_name.asc' });
      return res.status(200).json({ customers });
    }
    const body = await h.readJsonBody(req);
    if (body.action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const first = String(body.first_name || '').trim(), last = String(body.last_name || '').trim();
      const phone = String(body.phone || '').trim();
      if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !first || first.length > 75 || last.length > 75 || phone.length > 50)
        throw new Error('Enter a first name and valid email and contact details.');
      // Repeated submissions reuse the profile without modifying existing customer details.
      const [existing] = await h.restSelect('profiles', 'id,role', { email: `eq.${email}`, limit: '1' });
      if (existing) {
        if (existing.role !== 'customer') throw new Error('This email belongs to an administrator.');
        return res.status(200).json({ id: existing.id, existing: true });
      }
      const user = await authRequest('admin/users', {
        email, password: crypto.randomBytes(48).toString('base64url'), email_confirm: false,
        user_metadata: { first_name: first, last_name: last, phone },
      });
      return res.status(200).json({ id: user.id, existing: false });
    }
    if (!x.uuid(body.customer_id)) throw new Error('Choose a customer.');
    const [customer] = await h.restSelect('profiles', 'id,email,first_name,last_name,phone', { id: `eq.${body.customer_id}`, role: 'eq.customer', limit: '1' });
    if (!customer) throw new Error('Customer not found.');
    if (body.action === 'activation') {
      // Recovery proves email ownership and opens the existing password-setting screen.
      await authRequest(`recover?redirect_to=${encodeURIComponent(h.getSiteUrl() + '/account.html')}`, { email: customer.email });
      return res.status(200).json({ sent: true });
    }
    if (body.action === 'invoice') {
      req.body = {
        checkout_key: body.checkout_key,
        cart: body.cart,
        checkout: {
          customer: { full_name: `${customer.first_name} ${customer.last_name}`.trim(), email: customer.email, phone: customer.phone },
          payment_method: 'bank_transfer', fulfilment_method: 'pickup', service_details: body.service_details,
        },
      };
      // Only this authenticated admin route supplies the customer identity; never accept one from public checkout.
      return checkout(req, res, { id: customer.id, email: customer.email });
    }
    throw new Error('Unknown action.');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};
