import { config } from 'dotenv'
config()

import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import dayjs from 'dayjs'
import { GoogleSpreadsheet } from 'google-spreadsheet'
import creds from './google_sheets.json'
import { Tinder } from './tinder'
import { wait } from './util'

puppeteer.use(StealthPlugin())
;(async () => {
  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID)
  await doc.useServiceAccountAuth(creds)
  await doc.loadInfo()

  const accountsSheet = doc.sheetsByTitle['Accounts']
  const accounts = await accountsSheet.getRows()
  const locationsSheet = doc.sheetsByTitle['Locations']
  const locations = await locationsSheet.getRows()

  for (let account of accounts) {
    for (let location of locations.sort(() => 0.5 - Math.random())) {
      console.log(`Processing ${account.name} at ${location.name} :`)
      await processAccount(doc, account, location)
    }
  }

  process.exit()
})()

async function processAccount(
  doc: GoogleSpreadsheet,
  account: any,
  location: any
) {
  console.log('Starting browser...')
  const browser = await puppeteer.launch(<any>{
    args: [
      '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"',
    ],
    userDataDir: `/tmp/browser-data-${account.name}`,
    headless: false,
    executablePath: process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })

  /*
  const geocoder = NodeGeocoder({
    provider: 'google',
    apiKey: process.env.GOOGLE_API_KEY,
  })

  const coords = await geocoder.geocode(location.name)
  if (coords.length === 0) {
    throw Error('Failed to geocode.')
  }
  */

  const tinder = new Tinder(
    browser,
    account.facebook_login,
    account.facebook_password,
    location.name,
    +location.latitude,
    +location.longitude
  )
  console.log('Waiting for Tinder to be ready...')
  await tinder.ready()

  let nbLikes = 0
  let nbPasses = 0
  tinder.like$.subscribe(() => {
    nbLikes++
    console.log('LIKE')
  })
  tinder.pass$.subscribe(() => {
    nbPasses++
    console.log('PASS')
  })

  console.log('Starting actions.')
  for (let i = 0; i < 25000; i++) {
    if (await tinder.isOutOfLike()) break
    await tinder.hidePopup()

    await wait(150 + Math.random() * 150)

    //if (Math.random() > 0.5) await tinder.like()
    //else await tinder.pass()
    await tinder.like()

    await wait(200)
  }

  const activitySheet = doc.sheetsByTitle['Activity']
  console.log('Logging activity summary.')
  await activitySheet.addRow({
    account_name: account.name,
    date: dayjs().format('DD/MM/YYYY'),
    location: location.name,
    likes: nbLikes,
    passes: nbPasses,
  })
  const matchesSheet = doc.sheetsByTitle['Matches']
  console.log('Logging matches summary.')
  await matchesSheet.addRow({
    account_name: account.name,
    date: dayjs().format('DD/MM/YYYY'),
    location: location.name,
    matches: tinder.nbMatches,
    msg_matches: tinder.nbMsgMatches,
    liked_you: tinder.nbLikedMe,
    total_matches: tinder.totalMatches(),
  })

  await browser.close()

  console.log('Done.')
}
