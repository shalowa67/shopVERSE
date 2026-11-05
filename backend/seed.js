// Demo data loaded only when NODE_ENV is "development" or "test".
// Demo accounts are refused at login in any other environment.

const DEMO_PASSWORD = '123456';

const seedUsers = [
  {
    id: 'shop-owner-demo',
    name: 'Aisha Hassan',
    email: 'owner@shopverse.com',
    password: DEMO_PASSWORD,
    role: 'shop_owner',
    shopName: 'Aisha Essentials',
    shopDescription: 'Handpicked home and lifestyle goods for everyday living.',
    shopLocation: 'Lusaka, Zambia',
    shopThemeColor: '#4f46e5'
  },
  {
    id: 'shop-owner-demo-2',
    name: 'Chanda Mwila',
    email: 'chanda@shopverse.com',
    password: DEMO_PASSWORD,
    role: 'shop_owner',
    shopName: 'Copperbelt Tech',
    shopDescription: 'Phones, laptops and accessories with honest prices and local warranty.',
    shopLocation: 'Kitwe, Zambia',
    shopThemeColor: '#0e7490'
  },
  {
    id: 'shop-owner-demo-3',
    name: 'Natasha Banda',
    email: 'natasha@shopverse.com',
    password: DEMO_PASSWORD,
    role: 'shop_owner',
    shopName: 'Amber & Oud',
    shopDescription: 'Fragrances, skincare and small-batch beauty finds.',
    shopLocation: 'Livingstone, Zambia',
    shopThemeColor: '#b45309'
  },
  {
    id: 'customer-demo',
    name: 'Daniel Smith',
    email: 'customer@shopverse.com',
    password: DEMO_PASSWORD,
    role: 'customer'
  }
];

const product = (id, shopId, sortOrder, name, category, price, stock, description) => ({
  id,
  shopId,
  name,
  category,
  price,
  stock,
  description,
  image: null,
  sortOrder,
  createdAt: new Date(Date.now() - (20 - sortOrder) * 86400000).toISOString()
});

const seedProducts = [
  product('prod-1', 'shop-owner-demo', 0, 'Ceramic Mug Set', 'Home & living', 24.99, 18, 'A set of four artisanal stoneware mugs for tea and coffee lovers.'),
  product('prod-2', 'shop-owner-demo', 1, 'Cotton Tote Bag', 'Fashion', 18.5, 12, 'Breathable, durable canvas tote for everyday errands.'),
  product('prod-3', 'shop-owner-demo', 2, 'Desk Organizer', 'Books & stationery', 32, 9, 'Compact bamboo organizer for work essentials and stationery.'),
  product('prod-4', 'shop-owner-demo-2', 0, 'Wireless Earbuds Pro', 'Electronics', 449, 25, 'Active noise cancelling, 30-hour battery and a pocket-sized charging case.'),
  product('prod-5', 'shop-owner-demo-2', 1, 'Smartphone 128GB', 'Phones', 3299, 6, 'Dual SIM, 6.5" display and a 50MP camera. Ships with a 12-month local warranty.'),
  product('prod-6', 'shop-owner-demo-2', 2, 'Ultrabook 14"', 'Laptops', 8999, 3, 'Lightweight 14-inch laptop with 16GB RAM and a 512GB SSD.'),
  product('prod-7', 'shop-owner-demo-2', 3, 'Fast Charger 65W', 'Accessories', 289, 40, 'USB-C GaN charger that powers a laptop and phone at once.'),
  product('prod-8', 'shop-owner-demo-3', 0, 'Oud Eau de Parfum', 'Perfumes', 650, 10, 'Warm, woody oud with notes of amber and vanilla. 100ml.'),
  product('prod-9', 'shop-owner-demo-3', 1, 'Shea Butter Body Cream', 'Beauty & skincare', 145, 30, 'Rich, unscented cream made with unrefined shea butter.'),
  product('prod-10', 'shop-owner-demo-3', 2, 'Botanical Face Oil', 'Beauty & skincare', 210, 2, 'Lightweight blend of marula and baobab oils for a natural glow.')
];

module.exports = { seedUsers, seedProducts };
