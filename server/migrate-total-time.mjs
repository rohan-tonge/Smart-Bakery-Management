import mongoose from 'mongoose';

async function migrate() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_bakery_db';
  await mongoose.connect(uri);
  const products = await mongoose.connection.collection('products').find({}).toArray();
  console.log('Found', products.length, 'products');
  let updated = 0;
  for (const p of products) {
    const prep = typeof p.preparationTime === 'number' ? p.preparationTime : undefined;
    const prod = typeof p.productionTime === 'number' ? p.productionTime : undefined;
    if (prep !== undefined || prod !== undefined) {
      const combined = Math.round(((prep || 0) + (prod || 0)) * 10) / 10;
      await mongoose.connection.collection('products').updateOne(
        { _id: p._id },
        { $set: { totalTimeMinutes: combined } }
      );
      updated++;
      console.log(`Updated ${p.name}: prep=${prep}, prod=${prod} -> total=${combined}`);
    }
  }
  console.log(`Total products migrated: ${updated}`);
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
