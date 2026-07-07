// AdSense publisher id for the site. Set to "" to disable AdSense entirely — no
// loader script, no cookies, no Google consent CMP. This is the single on/off
// switch (the top-level landing has the same switch in its index.html).
//
// The actual consent banner is Google's CMP: create + publish a GDPR message in
// AdSense → Privacy & messaging. It then shows automatically wherever this loader
// runs. ads.txt lives once at the domain root (the easly1989.github.io repo) and
// authorises this publisher for the whole host, including /cloudbank/.
export const ADSENSE_CLIENT = "ca-pub-8801916031911396";
