// Editorial copy uses existing catalogue facts. No claims of personal testing,
// guaranteed delivery, unverified variants or customer reviews are added.
const categories = [
  ['junior-tennis-rackets', 'Junior Tennis Rackets NZ', 'Find a junior tennis racket for a growing player. Compare the listed lengths, weights and grip details, then ask Kim if you need help narrowing the choice.', p => p.category === 'Tennis Rackets' && /\bjr\b|\bjnr\b|junior/i.test(p.product_name)],
  ['tennis-rackets', 'Tennis Rackets NZ', 'Browse HEAD tennis rackets for junior and adult players. Check the exact model, grip size and availability before ordering; weight and racket length matter as much as the name on the frame.', p => p.category === 'Tennis Rackets'],
  ['pickleball-paddles', 'Pickleball Paddles NZ', 'Compare HEAD pickleball paddles by their listed weight, core thickness and handle dimensions. Open a product for its specifications and current availability.', p => p.category === 'Pickle Ball Paddle'],
  ['tennis-grips', 'Tennis Grips & Overgrips NZ', 'Refresh the feel of your racket with replacement grips, overgrips and finishing tape. Check the grip type and pack quantity, and combine small essentials in one order to spread the delivery cost.', p => p.category === 'Tennis Grips'],
  ['tennis-balls', 'Tennis Balls NZ', 'Choose tennis balls by the stated type and selling unit. Check whether the price is for a tube, bag or larger pack, and confirm timing for products available to order.', p => p.category === 'Tennis Balls'],
  ['tennis-bags', 'Tennis Bags & Backpacks NZ', 'Browse tennis backpacks and racket bags. Compare the listed dimensions and compartments against the rackets and kit you need to carry.', p => p.category === 'Tennis Bags'],
  ['tennis-strings', 'Tennis Strings NZ', 'Compare tennis strings by material, gauge and pack length. A string set and a reel are different quantities; stringing labour is sold separately where listed.', p => p.category === 'Tennis Strings'],
  ['dampeners', 'Tennis Racket Dampeners NZ', 'Choose a racket dampener by the stated shape, colour and pack quantity. Add one to a racket or grip order if it suits your setup.', p => p.category === 'Shock Absorbers'],
  ['pickleball-accessories', 'Pickleball Accessories NZ', 'Browse paddle accessories and covers. Check the dimensions and compatibility before adding a cover to your paddle order.', p => p.category === 'Pickle Ball Accessories'],
  ['training', 'Tennis Training Equipment NZ', 'Browse equipment for tennis practice. Check the selling unit, specifications and availability for each item before planning your next session.', p => p.category === 'Training'],
  ['accessories', 'Tennis Accessories NZ', 'Find tennis accessories to complete your kit. Open each listing for the colour, quantity and current availability, and contact Kim if a detail needs confirming.', p => p.category === 'Accessories'],
  ['racket-services', 'Racket Stringing Services', 'Arrange racket stringing with Kim. Labour and strings are listed separately; racket drop-off, string choice and tension need to be confirmed with Kim.', p => p.item_kind === 'service']
].map(([slug, title, intro, matches]) => ({ slug, title, intro, matches }));
const heroSkus = ['200626', '2312057', 'MT-B', '261804'];
const productCopy = {
  '200626': {
    name: 'HEAD Gravity Xceed Pickleball Paddle (2026)',
    intro: 'A HEAD pickleball paddle with a 17 mm core and fibreglass hitting surface, designed around touch and controlled contact. Compare its 232 g weight and 140 mm grip length with your preferred paddle setup.',
    paragraphs: ['The Gravity Xceed combines a 419 mm overall length with a 191 mm width. Its SpinOn surface and EVA inlay grip are part of the manufacturer’s design for this model.', 'Check the measurements below before ordering. A paddle cover is available separately; compare the cover dimensions with the paddle rather than assuming every cover fits.'],
    specs: [['Core thickness', '17 mm'], ['Weight', '232 g'], ['Length', '419 mm'], ['Width', '191 mm'], ['Grip length', '140 mm'], ['Balance', '245 mm']],
    mpn: '200626', related: ['261804']
  },
  '2312057': {
    name: 'HEAD IG Gravity Jr 26 Junior Tennis Racket (2025)',
    intro: 'A 26-inch junior tennis racket with a graphite-composite construction and a listed unstrung weight of 250 g. HEAD’s catalogue gives an age guide of 9–11 years; the player’s height, strength and experience also matter.',
    paragraphs: ['The 100-square-inch head and 16/19 string pattern are listed for this model. Use the measurements below to compare it with the racket the player currently uses.', 'The supplier description lists a range of grip sizes. Contact Kim to confirm the exact grip size supplied before ordering if grip fit matters to your choice.'],
    specs: [['Racket length', '26 in / 660 mm'], ['Weight, unstrung', '250 g'], ['Head size', '100 sq in / 645 cm²'], ['String pattern', '16/19'], ['Balance', '310 mm'], ['Beam', '22 mm'], ['Manufacturer age guide', '9–11 years']],
    mpn: '2312057', related: ['285515-BK', 'MT-B']
  },
  'MT-B': {
    name: 'Tourna Mega Tac Blue Overgrips — 3 Pack',
    intro: 'Three blue Tourna Mega Tac overgrips for refreshing the outer surface of your racket handle. An overgrip goes over the existing base grip; it is a different product from a full replacement grip.',
    paragraphs: ['Check that the Mega Tac version and three-grip pack are the products you want. Keep a spare in your racket bag, or combine this pack with other essentials in one order.', 'The price shown is for one pack of three overgrips. For fitting, follow the pack instructions and finish securely at the top of the handle.'],
    specs: [['Brand', 'Tourna'], ['Range', 'Mega Tac'], ['Colour', 'Blue'], ['Pack quantity', '3 overgrips']], related: ['285515-BK']
  },
  '261804': {
    name: 'HEAD Pickleball Paddle Coverbag',
    intro: 'A separate cover for storing and carrying a pickleball paddle. The supplier lists polyester for both the outside and lining, and a separate fit check recommended before ordering.',
    paragraphs: ['Ask Kim to confirm the cover fits your paddle before ordering. The paddle shown elsewhere in the shop is sold separately.', 'Add a compatible cover to the same order as your paddle if you want protection during transport. Contact Kim if you need the fit checked.'],
    specs: [['Outer material', '100% polyester'], ['Lining', '100% polyester'], ['Item', 'Coverbag only']], mpn: '261804', related: ['200626']
  }
};
function title(product) {
  const raw = String(product.product_name).replace(/ Paddle r$/, ' Paddle').trim();
  const match = raw.match(/^(\d{2})-HEAD (.+)$/);
  return productCopy[product.sku]?.name || (match ? `HEAD ${match[2]} (20${match[1]})` : raw);
}
function categoryFor(product) {
  return categories.find(category => category.matches(product));
}
function description(product) {
  return productCopy[product.sku]?.intro || String(product.full_description || product.description || product.short_description || `${title(product)} from Kim Jones Coaching.`).replace(/&nbsp;/g, ' ').trim();
}
module.exports = { categories, heroSkus, productCopy, title, categoryFor, description };
