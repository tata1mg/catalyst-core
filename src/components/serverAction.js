"use server";

const promise = () => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("success");
    }, 2000);
  });
};

export async function serverAction() {
  const res = await promise();
  console.log("Server action executed: ", res);
  return res;
}
