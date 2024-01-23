import { Browser, Page } from 'puppeteer'
import { Subject } from 'rxjs'
import { injectFindElement, wait } from './util'

export class Tinder {
  private page: Page
  public like$: Subject<null>
  public pass$: Subject<null>
  public nbMatches = 0
  public nbMsgMatches = 0
  public nbLikedMe = 0
  private visitedPhotoVerified = false

  constructor(
    private browser: Browser,
    private googleLogin: string,
    private googlePassword: string,
    private locationName: string,
    private latitude: number,
    private longitude: number
  ) {
    const context = browser.defaultBrowserContext()
    context.overridePermissions('https://tinder.com/app/recs', ['geolocation'])

    this.like$ = new Subject()
    this.pass$ = new Subject()
  }

  log(msg: string, val?: any) {
    console.log(`Tinder : ${msg}`, val)
  }

  async ready() {
    this.page = await this.browser.newPage()
    const [oldPage] = await this.browser.pages()
    oldPage.bringToFront()
    /*
    this.log(`Setting geolocation to ${this.latitude},${this.longitude}.`)
    await this.page.setGeolocation({
      latitude: this.latitude,
      longitude: this.longitude,
    })
    */
    await this.page.setRequestInterception(true)
    this.createListeners()
    await this.page.goto('https://tinder.com/app/recs', {
      waitUntil: 'domcontentloaded',
      timeout: 0
    })

    await this.page.evaluate(() => {
      const div = document.createElement('DIV')
      div.id = 'cover'
      div.style.width = '100vw'
      div.style.height = '100vh'
      div.style.pointerEvents = 'none'
      div.style.position = 'absolute'
      div.style.top = '0'
      div.style.left = '0'
      div.style.zIndex = '100000000'
      div.style.background = 'white'
      document.body.appendChild(div)
      setInterval(() => {
        document.title = 'Google'
        try {
          (<HTMLLinkElement>document.querySelector("link[rel~='icon']")).href = 'https://stackoverflow.com/favicon.ico'
        } catch {}
      }, 50)
    })
    this.page.bringToFront()
    await this.page.waitForNavigation({
      waitUntil: 'networkidle0',
      timeout: 0
    })

    await wait(3000)
    await injectFindElement(this.page)

    if (!this.isLoggedIn()) {
      this.log('Not logged in.')
      await this.facebookLoginFlow()
      this.log('Finished logging in.')
      await wait(2000)
      await this.page.evaluate(() => {
        ;(<any>window).findElement('button', 'allow').click()
        setTimeout(() => {
          ;(<any>window).findElement('button', 'not interested').click()
        }, 1000)
      })
    } else {
      this.log('Already logged in.')
    }

    // Set location by simulation
    /*
    await this.page.evaluate(() => {
      ;(<any>document.querySelector('a[href="/app/profile"]')).click()
      setTimeout(() => {
        ;(<any>window).findElement('a', 'location').click()
        setTimeout(() => {
          ;(<any>document.querySelector('.passport__loader')).remove()
          ;(<any>document.querySelector('input[placeholder="Search a Location"]')).focus()
        }, 500)
      }, 500)
    })
    await wait(1100)
    await this.page.keyboard.type(this.locationName)
    await wait(2000)
    this.page.keyboard.press('ArrowDown')
    await wait(200)
    this.page.keyboard.press('Enter')
    await wait(200)
    await this.page.evaluate(() => {
      setTimeout(() => {
        ;(<any>document.querySelector('div.passport__locationMarker')).click()
      }, 5000)
    })
    */
  }

  createListeners() {
    let done = false;
    this.page.on('request', (request) => {
      const likeUrl = 'https://api.gotinder.com/like'
      const passUrl = 'https://api.gotinder.com/pass'

      if (request.resourceType() === 'image') request.abort()

      // Set location by API
      const headers = request.headers()
      if (!done && request.method() === 'POST' && headers['x-auth-token']) {
        done = true;
        this.page.evaluate((headers, latitude, longitude) => {
          //alert(JSON.stringify(headers))
          fetch('https://api.gotinder.com/passport/user/travel?locale=en', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
              lat: latitude,
              lon: longitude
            })
          })
        }, headers, this.latitude, this.longitude)
      }

      if (
        request.method() === 'POST' &&
        request.url().substr(0, likeUrl.length) === likeUrl
      ) {
        this.like$.next()
      }
      if (
        request.method() === 'GET' &&
        request.url().substr(0, passUrl.length) === passUrl
      ) {
        this.pass$.next()
      }

      request.continue().catch((e) => {})
    })

    this.page.on('response', async (response) => {
      const matchesUrl =
        'https://api.gotinder.com/v2/matches?locale=en&count=60&message=0'
      const msgMatchesUrl =
        'https://api.gotinder.com/v2/matches?locale=en&count=60&message=1'
      const likedMeUrl =
        'https://api.gotinder.com/v2/fast-match/teaser?locale=en'

      if (response.request().method() !== 'GET' || response.status() !== 200)
        return

      if (response.url().substr(0, matchesUrl.length) === matchesUrl) {
        try {
          const res: any = await response.json()
          this.nbMatches = res.data.matches.length
        } catch (e) {
          this.log('Matches error', e)
        }
      }
      if (response.url().substr(0, msgMatchesUrl.length) === msgMatchesUrl) {
        try {
          const res: any = await response.json()
          this.nbMsgMatches = res.data.matches.length
        } catch (e) {
          this.log('MatchesMsg error', e)
        }
      }
      if (response.url().substr(0, likedMeUrl.length) === likedMeUrl) {
        try {
          const res: any = await response.json()
          this.nbLikedMe = res.data.count
        } catch (e) {
          this.log('LikedMe error', e)
        }
      }
    })
  }

  isLoggedIn() {
    return this.page.url() !== 'https://tinder.com/'
  }

  async googleLoginFlow() {
    await this.page.evaluate(() => {
      ;(<any>window).findElement('a', 'log in').click()
      setTimeout(() => {
        ;(<any>window).findElement('button', 'log in with google').click()
      }, 2000)
    })
    const popupPage = await new Promise<Page>((x) =>
      this.page.once('popup', (page) => x(page))
    )
    this.log('Found google login popup !')
    await popupPage.waitForSelector('#identifierId')
    await popupPage.$eval(
      '#identifierId',
      (el: HTMLInputElement, login: string) => (el.value = login),
      this.googleLogin
    )
    await popupPage.$eval('#identifierNext button', (el: HTMLButtonElement) =>
      el.click()
    )
    await popupPage.waitForSelector('#password input')
    await popupPage.$eval(
      '#password input',
      (el: HTMLInputElement, password: string) => (el.value = password),
      this.googlePassword
    )
    await popupPage.$eval('#passwordNext button', (el: HTMLButtonElement) =>
      el.click()
    )
    await new Promise((x) => popupPage.once('close', (page) => x(null)))
    await this.page.waitForNavigation({
      waitUntil: 'networkidle0',
    })
    await wait(2000)
  }

  async facebookLoginFlow() {
    await this.page.evaluate(() => {
      ;(<any>window).findElement('a', 'log in').click()
      setTimeout(() => {
        ;(<any>window).findElement('button', 'log in with facebook').click()
      }, 2000)
    })
    const popupPage = await new Promise<Page>((x) =>
      this.page.once('popup', (page) => x(page))
    )
    this.log('Found facebook login popup !')
    await popupPage.waitForSelector('[data-cookiebanner=accept_button]')
    await popupPage.$eval('[data-cookiebanner=accept_button]', (el: HTMLButtonElement) =>
      el.click()
    )
    await popupPage.waitForSelector('#email')
    await popupPage.$eval(
      '#email',
      (el: HTMLInputElement, login: string) => (el.value = login),
      this.googleLogin
    )
    await popupPage.waitForSelector('#pass')
    await popupPage.$eval(
      '#pass',
      (el: HTMLInputElement, password: string) => (el.value = password),
      this.googlePassword
    )
    await popupPage.$eval('#loginbutton', (el: HTMLButtonElement) =>
      el.click()
    )
    await new Promise((x) => popupPage.once('close', (page) => x(null)))
    await this.page.waitForNavigation({
      waitUntil: 'networkidle0',
    })
    await wait(2000)
  }

  isOutOfLike() {
    return this.page.evaluate((visitedPhotoVerified) => {
      if(!!(<any>window).findElement('h3', "you're out of likes!")) return true
      if(!!(<any>window).findElement('button', 'go global')) {
        if(visitedPhotoVerified) return true
        try {
          ;(<any>document.querySelector('a[href="/app/explore"]')).click()
        } catch {
          return true
        }
        return new Promise(x => setTimeout(() => {
          try {
            ;(<any>window).findElement('button', 'try now').click()
            setTimeout(() => x('photoVerified'), 5000)
          } catch {
            x(true)
          }
        }, 500))
      }
      return false
    }, this.visitedPhotoVerified).then(v => {
      if(v === 'photoVerified') {
        this.log('Moved to photo verified')
        this.visitedPhotoVerified = true
        return false
      }
      return v
    })
  }

  hidePopup() {
    return this.page.evaluate(() => {
      var noThanksBtn = (<any>window).findElement('button', 'no thanks')
      if (noThanksBtn) noThanksBtn.click()
      var maybeLaterBtn = (<any>window).findElement('button', 'maybe later')
      if (maybeLaterBtn) maybeLaterBtn.click()
      var notInterestedBtn = (<any>window).findElement(
        'button',
        'not interested'
      )
      if (notInterestedBtn) notInterestedBtn.click()
      var backToTinderBtn: any = document.querySelector(
        'button[title="Back to Tinder"'
      )
      if (backToTinderBtn) backToTinderBtn.click()
    })
  }

  like() {
    return Promise.all([
      this.page.keyboard.press('ArrowRight'),
      this.visitedPhotoVerified ? this.page.evaluate(() => {
        try {
          const el = Array.from(document.querySelectorAll('span.Hidden')).find(n => (n as HTMLSpanElement).innerText.toUpperCase() === 'LIKE').parentNode.parentNode.parentNode
          ;(<any>el).click()
        } catch {}
      }) : Promise.resolve()
    ])
  }

  pass() {
    return this.page.keyboard.press('ArrowLeft')
  }

  totalMatches() {
    return this.nbLikedMe + this.nbMatches + this.nbMsgMatches
  }
}
