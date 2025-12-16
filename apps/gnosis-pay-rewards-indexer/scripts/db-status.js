import mongoose from 'npm:mongoose@8.5.1';
// Deno automatically has access to environment variables via Deno.env
// No need for dotenv in Deno

const uri = Deno.env.get('MONGODB_URI');

if (!uri) {
  console.error('Error: MONGODB_URI is not defined.');
  Deno.exit(1);
}

async function checkStatus() {
  try {
    // Connect to MongoDB
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    
    // Default collection name based on Mongoose pluralization usually 'gnosispaytransactions'
    // But let's check what exists just in case
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    const txCollectionName = collectionNames.find(n => n.toLowerCase().includes('gnosispaytransaction')) || 'gnosispaytransactions';
    
    const collection = db.collection(txCollectionName);

    console.log(`\nUsing Collection: ${txCollectionName}`);
    console.log('-----------------------------------');

    // 1. Total Count
    const totalCount = await collection.countDocuments();
    console.log(`Total Transactions:       ${totalCount}`);

    // 2. Recent Count (Last 3 weeks)
    const threeWeeksAgoSeconds = Math.floor(Date.now() / 1000) - (500 * 24 * 60 * 60);
    const recentCount = await collection.countDocuments({
      blockTimestamp: { $gte: threeWeeksAgoSeconds }
    });
    console.log(`Recent (Last 3 Weeks):    ${recentCount}`);

    // 3. Latest Block
    const latestTx = await collection.findOne({}, { sort: { blockNumber: -1 } });
    if (latestTx) {
      console.log(`Latest Block Number:      ${latestTx.blockNumber}`);
      console.log(`Latest Block Time:        ${new Date(latestTx.blockTimestamp * 1000).toISOString()}`);
    } else {
      console.log('Latest Block:             N/A (No transactions found)');
    }
    
    // 4. Oldest in recent period
    if (recentCount > 0) {
      const oldestRecentTx = await collection.findOne(
        { blockTimestamp: { $gte: threeWeeksAgoSeconds } },
        { sort: { blockNumber: 1 } }
      );
      if (oldestRecentTx) {
        console.log(`Oldest Recent Block:      ${oldestRecentTx.blockNumber}`);
        console.log(`Oldest Recent Time:       ${new Date(oldestRecentTx.blockTimestamp * 1000).toISOString()}`);
      }
    }

    // 5. Gap detection in blockNumber sequence
    if (totalCount > 0) {
      const GAP_THRESHOLD = 1000n;
      const gaps = [];
      let prev = null;

      const cursor = collection
        .find({}, { projection: { blockNumber: 1, _id: 0 } })
        .sort({ blockNumber: 1 });

      for await (const doc of cursor) {
        const bn = BigInt(doc.blockNumber);

        if (prev !== null && bn > prev + 1n) {
          const size = bn - prev - 1n;
          if (size >= GAP_THRESHOLD) {
            gaps.push({
              from: prev + 1n,
              to: bn - 1n,
              size,
            });
          }
        }

        prev = bn;
      }

      if (gaps.length === 0) {
        console.log(`Block gaps (>${GAP_THRESHOLD.toString()}): none ✅`);
      } else {
        console.log(`Block gaps (>${GAP_THRESHOLD.toString()}): ${gaps.length} gap(s) detected`);
        const maxToShow = 20;
        gaps.slice(0, maxToShow).forEach((gap, index) => {
          console.log(
            `  ${index + 1}. missing from ${gap.from.toString()} to ${gap.to.toString()} (size ${gap.size.toString()})`,
          );
        });
        if (gaps.length > maxToShow) {
          console.log(`  ...and ${gaps.length - maxToShow} more`);
        }
      }
    } else {
      console.log('Block gaps:               N/A (no transactions)');
    }

    console.log('-----------------------------------\n');

  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    await mongoose.disconnect();
  }
}

checkStatus();
