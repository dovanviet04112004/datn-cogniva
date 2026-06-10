/** Check nhanh status+body 1 URL — node scripts/check-route.mjs <url...> */
for (const url of process.argv.slice(2)) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    console.log(`${res.status} ${url} :: ${text.slice(0, 200)}`);
  } catch (err) {
    console.log(`ERR ${url} :: ${err.message}`);
  }
}
