# dishwater bag

catch falling cats in a paper bag. miss three and it's over.

a small browser game, plain html + css + javascript on a canvas

avaliable to play at https://dishwater-bag.vercel.app/

## running it yourself

```
npm install
npm run dev
```

that starts a dev server and reloads the page whenever a file changes, which is
the nicer way to work on it.

you can also just open `index.html` in a browser. it needs no server at all, and
that is deliberate, `game.js` is a plain script rather than a module so the page
works straight off the filesystem.

## controls

| key | does |
| --- | --- |
| left / right arrow, or A / D | move the bag |
| P | pause |
| space | start, or restart after a game over |

the bag also follows the mouse or a trackpad, which works on a touchscreen too.

## rules

cats fall from the top. catch one and you score, drop one and you lose a life.
you start with three. the poop is the thing you are meant to *let* fall, it only
costs you a life if you catch it.

| falls | worth | how often |
| --- | --- | --- |
| big cat | 1 point | 48% |
| medium cat | 3 points | 24% |
| small cat | 6 points | 11% |
| poop | costs a life if caught | 16% |

all three cats are the same sprite drawn at different sizes, so the tiers are
told apart by how big they are. the smaller the cat the more it is worth.

things speed up over the first 60 seconds and then level off at 2.25x the
starting pace, so it gets harder without running away from you. your best score
is kept in `localStorage`.

## leaderboard

off until you connect it. with `leaderboard.js` left as it ships there is no
name prompt and no board, the game plays exactly as it does offline.

to turn it on:

1. make a project at [supabase.com](https://supabase.com)
2. open the sql editor and run `supabase-schema.sql`
3. copy the project url and the **publishable** key (`sb_publishable_...`) from
   project settings, api keys
4. paste both into the top of `leaderboard.js`
