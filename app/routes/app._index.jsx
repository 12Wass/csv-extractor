// app._index.jsx (already existing)

import { useRef } from "react";
import { json } from "@remix-run/node";
import { useActionData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  List,
  Link,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { parseCSV } from "../csv.server";


export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const transactions = await parseCSV(request);
  const { admin } = await authenticate.admin(request);

  let responses = [];

  for await (const trx of transactions) {
    // If trx.order : search directly for the right order
    let isSingleOrder = false;
    if (trx.order) {
      const getSingleOrder = await admin.graphql(`
      #graphql
      query getSingleOrder ($name: String) {
        orders(first: 1, query: $name) {
          edges {
           node {
            id,
            name,
            createdAt,
            displayFinancialStatus,
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              id,
              firstName,
              lastName,
            }
           } 
          }
            }
      }`,
      {
        variables: {
          name: trx.order
        }
      });
      
      const singleOrder = await getSingleOrder.json();
      if (singleOrder.data.orders.edges[0] !== undefined) {
        isSingleOrder = true
        const singleOrderData = singleOrder.data.orders.edges[0]["node"];
        const customerName = singleOrderData.customer.lastName.toUpperCase() + " " + singleOrderData.customer.firstName.toUpperCase();
        if (customerName === trx.name) {
          if (singleOrderData.totalPriceSet.shopMoney.amount === trx.credit) {
            if (singleOrderData.displayFinancialStatus === "PENDING") {
              const orderMarkAsPaid = await admin.graphql(
                `#graphql
                mutation orderMarkAsPaid ($input: ID!) {
                 orderMarkAsPaid(input: {id: $input}) {
                  order {
                    id
                    name
                  }
                  userErrors {
                    field
                    message
                  }
                 } 
                }`,
                {
                  variables: {
                    input: singleOrderData.id
                  }
                });
                const orderMarked = await orderMarkAsPaid.json();
            } else {
              console.log("Order has been paid already", singleOrderData.name)
            }
            responses.push(singleOrder.data.orders.edges[0]["node"]);
          } else {
            console.log("Amount is not matching for ", trx.name, "- CSV amount : ", trx.credit, "- Expected amount : ", singleOrderData.totalPriceSet.shopMoney.amount);
          }
        } else {
          console.log("Name is not matching for ", trx.name, "- Expected name : ", customerName)
        }
        responses.push(singleOrder.data.orders.edges[0]["node"]);
      }
    } 
    // If there's no order number in the CSV, we get it by name.
    if (!trx.order || isSingleOrder === false) {
      const getCustomer = await admin.graphql(
        `#graphql
        query getCustomers ($customerName: String){
          customers(first: 2, query: $customerName) {
            edges {
              node {
                id,
                firstName,
                lastName,
              }
            }
          },
        },`,
        {
          variables: {
            customerName: trx.name
          }
        }
      );
      const customer = await getCustomer.json();

      // 1 or more customers with same first name / last name has been found, we can use his ID to search for his orders
      if (customer.data.customers.edges[0]) {
        // Improve axis : Loop through each user found - then loop through the last 5 orders for each user looking for the exact amount.
        for (const customerId of customer.data.customers.edges) {
          // Get last 5 orders of current user using his ID
          const orders = await admin.graphql(
            `#graphql
            query getOrdersByCustomers ($customerId: ID!) {
              customer(id: $customerId) {
                firstName,
                lastName,
                orders(first: 5, query: "status:any"){
                  edges {
                    node {
                      id
                    }
                  }
                }
              }
            }`,
            {
              variables: {
                customerId: customerId
              }
            }
          );
          const fullOrders = await orders.json();
          const fullName = fullOrders.data.customer.lastName.toUpperCase() + " " + fullOrders.data.customer.firstName.toUpperCase();
          if (fullName === trx.name) {
            for (const order of fullOrders.data.orders.edges) {
              const getOrder = await admin.graphql(
                `#graphql
                query getOrderById ($orderId: ID!) {
                  order(id: $orderId) {
                    name,
                    createdAt,
                    displayFinancialStatus,
                    totalPriceSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                }`,
                {    
                  variables: {
                    orderId: order.id
                  }
                }
              );
              const loopedOrder = getOrder.json();
              if (loopedOrder.displayFinancialStatus === "PENDING") {
                if (loopedOrder.shopMoney.amount === trx.credit) {
                  const orderMarkAsPaid = await admin.graphql(
                    `#graphql
                    mutation orderMarkAsPaid ($input: ID!) {
                     orderMarkAsPaid(input: {id: $input}) {
                      order {
                        id
                        name
                      }
                      userErrors {
                        field
                        message
                      }
                     } 
                    }`,
                    {
                      variables: {
                        input: loopedOrder.id
                      }
                    });
                  const orderMarked = await orderMarkAsPaid.json();
                  console.log(orderMarked);
                } else {
                  console.log("Not good amount");
                }
              } else {
                console.log("Not good status");
              }
            }
          }
        }

        // OLD WAY
        const customerId = customer.data.customers.edges[0]["node"].id;
        const orders = await admin.graphql(
          `#graphql
          query getOrdersByCustomers ($customerId: ID!) {
            customer(id: $customerId) {
              firstName,
              lastName,
              orders(first: 2, query: "status:any"){
                edges {
                  node {
                    id
                  }
                }
              }
            }
          }`,
          {
            variables: {
              customerId: customerId
            }
          }
        );
        const fullOrders = await orders.json();
        const fullName = fullOrders.data.customer.lastName.toUpperCase() + " " + fullOrders.data.customer.firstName.toUpperCase();
        // Orders has been found for the customer we just gathered
        if (fullOrders.data.customer.orders.edges[0]) {
          if (fullName === trx.name) {
            const orderId = fullOrders.data.customer.orders.edges[0]["node"].id;
            const getOrder = await admin.graphql(
              `#graphql
              query getOrderById ($orderId: ID!) {
                order(id: $orderId) {
                  name,
                  createdAt,
                  displayFinancialStatus,
                  totalPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                }
              }`,
              {    
                variables: {
                  orderId: orderId
                }
              }
            );

            const order = await getOrder.json();
            orderAmount = order.data.order.totalPriceSet.shopMoney.amount;

            // Now we check the value we receive
            if (orderAmount === trx.credit) {
              // Order has the right name / amount here
              if (order.data.order.displayFinancialStatus === "PENDING") {
                const multipleOrderMarkAsPaid = await admin.graphql(
                  `#graphql
                  mutation orderMarkAsPaid ($input: ID!) {
                   orderMarkAsPaid(input: {id: $input}) {
                    order {
                      id
                      name
                    }
                    userErrors {
                      field
                      message
                    }
                   } 
                  }`,
                  {
                    variables: {
                      input: order.data.order.id
                    }
                  });
                  const updatedOrder = await multipleOrderMarkAsPaid.json();
                  console.log(updatedOrder);
              } else {
                console.log("Order has been paid already : ", updatedOrder.name)
              }
              responses.push(order)
            } else {
              console.log("Amount is not matching for ", trx.name, "- CSV amount : ", trx.credit, "- Expected amount : ", orderAmount);
            }
          } else {
            console.log("Name is not matching for ", trx.name, "- Expected name : ", fullName)
          }
        } else {
          // Log that no order was found for this very user in the error array.
          console.log('No order found for user', trx.name);
        }
      } else {
        // Log that we couldn't find any user with the CSV informations (in the error array)
        console.log('No customer found for user ', trx.name)
      }
    }
  };

  return json({
    orders: responses,
  });

}

export default function Index() {
  const nav = useNavigation();
  const actionData = useActionData();
  const submit = useSubmit();
  const formRef = useRef();
  const isLoading =
    ["loading", "submitting"].includes(nav.state) && nav.formMethod === "POST";

  const parseCsv = () => submit(formRef.current, { replace: true, method: "POST", encType: 'multipart/form-data' });

  return (
    <Page>
      <ui-title-bar title="PARSE MOI PITIE">
      </ui-title-bar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
              <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    CSV Parser Vinci 🎉
                  </Text>
                  <Text variant="bodyMd" as="p">
                    Importe ton CSV ci-dessous, je m'occupe du reste.
                  </Text>
                </BlockStack>
                <InlineStack gap="300">
                  <form ref={formRef} method="post" action="" encType="multipart/form-data">
                    <input type="file" name="csv" accept=".csv" />
                    <Button onClick={parseCsv}>Envoyer le CSV</Button>
                  </form>
                </InlineStack>
                {actionData?.orders && (
                  <Box
                    padding="400"
                    background="bg-surface-active"
                    borderWidth="025"
                    borderRadius="200"
                    borderColor="border"
                    overflowX="scroll"
                  >
                    <pre style={{ margin: 0 }}>
                    <code>{JSON.stringify(actionData.orders, null, 2)}</code>
                    </pre>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    App template specs
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Framework
                      </Text>
                      <Link
                        url="https://remix.run"
                        target="_blank"
                        removeUnderline
                      >
                        Remix
                      </Link>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Database
                      </Text>
                      <Link
                        url="https://www.prisma.io/"
                        target="_blank"
                        removeUnderline
                      >
                        Prisma
                      </Link>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Interface
                      </Text>
                      <span>
                        <Link
                          url="https://polaris.shopify.com"
                          target="_blank"
                          removeUnderline
                        >
                          Polaris
                        </Link>
                        {", "}
                        <Link
                          url="https://shopify.dev/docs/apps/tools/app-bridge"
                          target="_blank"
                          removeUnderline
                        >
                          App Bridge
                        </Link>
                      </span>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        API
                      </Text>
                      <Link
                        url="https://shopify.dev/docs/api/admin-graphql"
                        target="_blank"
                        removeUnderline
                      >
                        GraphQL API
                      </Link>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Next steps
                  </Text>
                  <List>
                    <List.Item>
                      Build an{" "}
                      <Link
                        url="https://shopify.dev/docs/apps/getting-started/build-app-example"
                        target="_blank"
                        removeUnderline
                      >
                        {" "}
                        example app
                      </Link>{" "}
                      to get started
                    </List.Item>
                    <List.Item>
                      Explore Shopify’s API with{" "}
                      <Link
                        url="https://shopify.dev/docs/apps/tools/graphiql-admin-api"
                        target="_blank"
                        removeUnderline
                      >
                        GraphiQL
                      </Link>
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
