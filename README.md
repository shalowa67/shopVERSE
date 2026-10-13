# shopVERSE
marketing  place 

Demo accounts and sample marketplace data are created only when `NODE_ENV` is
`development` or `test`. Set `NODE_ENV=production` for production deployments;
demo accounts saved by earlier versions are not allowed to authenticate.

For Render deployments, create a PostgreSQL database and set the web service's
`DATABASE_URL` environment variable to the database's internal connection URL.
Production startup requires this variable because Render free web services do
not retain files across deployments. The app stores account password hashes,
marketplace data, and sessions in PostgreSQL. A deployment cannot recover data
that was already lost from an ephemeral SQLite file; restore a backup before
deploying if one is available.
