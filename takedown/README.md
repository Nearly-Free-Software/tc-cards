# Taking TC Cards down

Deleting the Vercel project on its own isn't enough. Phones that installed TC Cards keep serving their offline copy. When `sw.js` returns 404, the browser keeps the old service worker. So retire it in two steps.

## 1. Deploy the tombstone

Swap the served folder for the files in `takedown/public/`, then deploy to production:

```sh
mv public public.live && cp -R takedown/public public
vercel deploy --prod
```

When an installed copy next opens with signal, it does the following:

- picks up the new `sw.js`;
- deletes the cached app and deck;
- unregisters the service worker and reloads;
- shows a short "TC Cards has been retired" page, which also clears the stored key and card progress.

Ask anyone who installed it to delete the home screen icon.

## 2. Remove the project, a few weeks later

```sh
vercel remove <project-name>
```

Then restore your working folder with `rm -rf public && mv public.live public`.
