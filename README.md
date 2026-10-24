# datacompiler-web

Site statique de data-compiler.com (HTML/CSS/JS, aucune dépendance, aucun build).

## Déployer
- Netlify > Add new site > Deploy manually : glisser le dossier (ou le zip), puis ajouter le domaine data-compiler.com.
- Plus tard : connecter ce dépôt (uniquement celui-ci) pour déployer à chaque `git push`.

## Démo
`app.js` : `CONFIG.DEMO = true` renvoie des résultats simulés (chiffres fictifs ; le nom du fichier choisit le cas : « polish » → révision humaine, « tax » → prêt). Passer à `false` quand `api.data-compiler.com` répond (`/upload`, `/status/{id}`, `/result/{id}`).

## Règles
- Aucun secret dans ce dépôt (clés OpenRouter, etc. : sur le serveur uniquement).
- L'aperçu flouté doit être une image floutée côté serveur (`preview_url`) ; le flou CSS n'est qu'un décor de démo.
- Tarifs, délais et textes de `pricing.html` sont provisoires.
