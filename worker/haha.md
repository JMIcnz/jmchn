# backend of bizify

## add tsconfig.json

## Stripe Webhook Endpoint
https://docs.stripe.com/development/dashboard/webhooks  
https://bizify.jmi.workers.dev/webhooks/stripe

## curl https://bizify.jmi.workers.dev/products 
internal server error  

check the log and solve it  
The error is `could not determine data type of parameter $1` — Neon's tagged template driver can't infer the type when you pass `null` directly into conditional expressions like `${category ?? null} IS NULL`. The fix is to build the query conditionally instead.

Diagnosed database parameter type issue and devised conditional query fix

Diagnosed database parameter type issue and devised conditional query fix

View the products route

View more of the file to find other null parameter issues

Now I understand the issue. The products route uses `${category ?? null} IS NULL` pattern which Neon can't handle because it can't determine the type of `null`. I need to rewrite the products query to use conditional SQL building instead.

## add role to users
```ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'customer';```

## add a record then alter the role to admin
```UPDATE users SET role = 'admin' WHERE email = 'YOUR_EMAIL';```



