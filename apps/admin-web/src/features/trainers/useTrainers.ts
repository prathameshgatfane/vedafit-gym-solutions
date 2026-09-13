import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSessionStore } from "../../stores/session.store";
import { memberKeys } from "../members/useMembers";
import {
  assignTrainerMember,
  createTrainer,
  getTrainer,
  listTrainerCandidates,
  listTrainers,
  unassignTrainerMember,
  updateTrainer,
  type TrainerPage,
} from "./trainers.api";
import type { TrainerFormValues } from "./trainer.schema";
import type { TrainerCandidate, TrainerListParams, TrainerProfile } from "./trainer.types";

export const trainerKeys = {
  all: (organizationId: string) => ["trainers", organizationId] as const,
  list: (organizationId: string, params: TrainerListParams) =>
    ["trainers", organizationId, "list", params] as const,
  candidates: (organizationId: string) =>
    ["trainers", organizationId, "candidates"] as const,
  detail: (organizationId: string, trainerId: string) =>
    ["trainers", organizationId, "detail", trainerId] as const,
};

function useOrganizationId(): string {
  const organizationId = useSessionStore((s) => s.organization?.id);
  return organizationId ?? "";
}

export function useTrainerList(params: TrainerListParams): UseQueryResult<TrainerPage> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: trainerKeys.list(organizationId, params),
    queryFn: () => listTrainers(organizationId, params),
    enabled: organizationId !== "",
    placeholderData: keepPreviousData,
  });
}

export function useTrainerCandidates(): UseQueryResult<TrainerCandidate[]> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: trainerKeys.candidates(organizationId),
    queryFn: () => listTrainerCandidates(organizationId),
    enabled: organizationId !== "",
  });
}

export function useTrainer(trainerId: string | undefined): UseQueryResult<TrainerProfile> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: trainerKeys.detail(organizationId, trainerId ?? ""),
    queryFn: () => getTrainer(organizationId, trainerId!),
    enabled: organizationId !== "" && Boolean(trainerId),
  });
}

export function useCreateTrainer(): UseMutationResult<TrainerProfile, unknown, TrainerFormValues> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: TrainerFormValues) => createTrainer(organizationId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: trainerKeys.all(organizationId) });
    },
  });
}

export function useUpdateTrainer(
  trainerId: string,
): UseMutationResult<TrainerProfile, unknown, TrainerFormValues> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: TrainerFormValues) => updateTrainer(organizationId, trainerId, values),
    onSuccess: (trainer) => {
      queryClient.setQueryData(trainerKeys.detail(organizationId, trainerId), trainer);
      void queryClient.invalidateQueries({ queryKey: trainerKeys.all(organizationId) });
    },
  });
}

export function useAssignTrainerMember(
  trainerId: string,
): UseMutationResult<TrainerProfile, unknown, string> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) => assignTrainerMember(organizationId, trainerId, memberId),
    onSuccess: (trainer) => {
      queryClient.setQueryData(trainerKeys.detail(organizationId, trainerId), trainer);
      void queryClient.invalidateQueries({ queryKey: trainerKeys.all(organizationId) });
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(organizationId) });
    },
  });
}

export function useUnassignTrainerMember(
  trainerId: string,
): UseMutationResult<TrainerProfile, unknown, string> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) => unassignTrainerMember(organizationId, trainerId, memberId),
    onSuccess: (trainer) => {
      queryClient.setQueryData(trainerKeys.detail(organizationId, trainerId), trainer);
      void queryClient.invalidateQueries({ queryKey: trainerKeys.all(organizationId) });
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(organizationId) });
    },
  });
}
