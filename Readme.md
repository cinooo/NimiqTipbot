# Intro

Sample Nimiq application that serves as a bot for tipping functions.

It is currently hosted on an t2.medium ec2 instance

You must get valid API oauth credentials for the respective APIs if you wish to start the bot (e.g. from Reddit or Discord)

Transactions & users are currently logged to a database (dynamo db), a separate polling function scans the table to process the crypto transactions

A sample .env (.env-sample) is provided which is required to run, rename this to .env and replace with your own values

### todo

* Refactoring
