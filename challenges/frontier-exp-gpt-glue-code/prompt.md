Write a Node.js Express service that acts as infrastructure glue between the Stripe API, the Slack API, and a PostgreSQL database.

The script needs to do the following:

Expose a webhook endpoint to receive Stripe 'invoice.payment_failed' events.

Parse the Stripe payload to get the customer ID and the failed amount.

Query the PostgreSQL database to find the user's account manager email based on the Stripe customer ID.

Use the Slack API to dynamically look up the Slack user ID of the account manager via their email.

Send an interactive Slack Block Kit message to the account manager with the failed amount, the customer's name, and a button to 'Pause Service'.

Handle rate limiting for the APIs, implement basic exponential backoff for the database queries, and ensure the webhook payload signature is verified. Output the full, production-ready script

Here is the structure of the incoming Stripe Webhook for your reference:
{
"type": "invoice.payment_failed",
"data": {
"object": {
"customer": "cus_M8hx9XyA2LqN",
"customer_name": "Acme Corp",
"amount_due": 49900,
"currency": "usd"
}
}
}

Here is the PostgreSQL schema for the users table:
TABLE account_managers (
id UUID PRIMARY KEY,
stripe_customer_id VARCHAR(255) UNIQUE,
manager_email VARCHAR(255),
region VARCHAR(50)
);
