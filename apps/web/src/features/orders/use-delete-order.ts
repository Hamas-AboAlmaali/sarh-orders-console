import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteRequest } from "../../lib/api-client";
import { orderKeys } from "./order-keys";

export function useDeleteOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) => deleteRequest(`/api/orders/${orderId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}
