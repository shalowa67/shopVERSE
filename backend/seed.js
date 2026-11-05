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
    shopThemeColor: '#4f46e5',
    shopPhone: '+260 97 000 0001',
    delivery: { enabled: true, fee: 0, freeOver: null, areas: 'Free delivery within Lusaka', pickup: true },
    verification: { status: 'verified', businessName: 'Aisha Essentials', reviewedAt: '2026-01-10T09:00:00.000Z' }
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
    shopThemeColor: '#0e7490',
    shopPhone: '+260 96 000 0002',
    delivery: { enabled: true, fee: 50, freeOver: 1000, areas: 'Copperbelt same day; other towns by bus parcel', pickup: true },
    verification: { status: 'verified', businessName: 'Copperbelt Tech Ltd', reviewedAt: '2026-01-12T09:00:00.000Z' }
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
    shopThemeColor: '#b45309',
    shopPhone: '+260 95 000 0003',
    delivery: { enabled: true, fee: 35, freeOver: 500, areas: 'Livingstone and nationwide by courier', pickup: false },
    verification: {
      status: 'pending',
      businessName: 'Amber & Oud',
      idNumber: '123456/10/1',
      note: 'Registered with PACRA in 2025.',
      submittedAt: '2026-02-01T09:00:00.000Z'
    }
  },
  {
    id: 'customer-demo',
    name: 'Daniel Smith',
    email: 'customer@shopverse.com',
    password: DEMO_PASSWORD,
    role: 'customer'
  },
  {
    id: 'admin-demo',
    name: 'ShopVerse Admin',
    email: 'admin@shopverse.com',
    password: DEMO_PASSWORD,
    role: 'admin'
  }
];

// Demo payment accounts shown at checkout in development. Production values come from
// environment variables (see .env.example); these are clearly fake.
const demoPaymentAccounts = {
  accountName: 'ShopVerse Payments (demo)',
  mtn: '096 000 0000',
  airtel: '097 000 0000',
  zamtel: '095 000 0000',
  bank: 'Demo Bank · Account 0000000000 · Branch Lusaka'
};

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

module.exports = { seedUsers, seedProducts, demoPaymentAccounts };
