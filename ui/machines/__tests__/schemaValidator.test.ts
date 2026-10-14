import { describe, expect, it } from 'vitest';
import { assign, createActor, createMachine, waitFor } from 'xstate';
import { DATA_VALIDATOR_EVENTS, dataValidatorCommands } from '@sistent/sistent';
import { componentKey, schemaValidatorMachine } from '../validator/schemaValidator';

describe('componentKey', () => {
  it('combines kind, model name and version with hyphens', () => {
    const component = {
      component: { kind: 'Pod', version: 'core/v1' },
      modelReference: { name: 'kubernetes' },
    };
    expect(componentKey(component)).toBe('Pod-kubernetes-core/v1');
  });

  it('returns a key for any input shape carrying the required fields', () => {
    expect(
      componentKey({
        component: { kind: 'Service', version: 'v1' },
        modelReference: { name: 'k8s' },
      }),
    ).toBe('Service-k8s-v1');
  });
});

describe('schemaValidatorMachine', () => {
  it('boots into the idle.waiting state', () => {
    const actor = createActor(schemaValidatorMachine);
    actor.start();
    const snap = actor.getSnapshot();
    // Per the dataValidatorMachine state graph (idle: { waiting | debouncing })
    expect(typeof snap.value).toBeDefined();
    actor.stop();
  });

  it('exposes a snapshot context with the validator slots', () => {
    const actor = createActor(schemaValidatorMachine);
    actor.start();
    const ctx = actor.getSnapshot().context;
    expect(ctx).toHaveProperty('validationResults');
    expect(ctx).toHaveProperty('validationPayload');
    expect(ctx).toHaveProperty('returnAddress');
    actor.stop();
  });

  it('includes an unsupported payload type in the validation failure', async () => {
    const receiver = createActor(
      createMachine({
        initial: 'waiting',
        context: { error: null },
        states: {
          waiting: {
            on: {
              [DATA_VALIDATOR_EVENTS.DESIGN_VALIDATION_FAILED]: {
                target: 'received',
                actions: assign({
                  error: ({ event }) => event.data.systemErrors,
                }),
              },
            },
          },
          received: {},
        },
      }),
    );
    const validator = createActor(schemaValidatorMachine);

    receiver.start();
    validator.start();

    try {
      validator.send(
        dataValidatorCommands.validateData({
          validationPayload: {
            validationPayloadType: 'unsupported',
          },
          returnAddress: receiver,
        }),
      );

      const snapshot = await waitFor(receiver, (state) => state.matches('received'));

      expect(snapshot.context.error).toBeInstanceOf(Error);
      expect(snapshot.context.error.message).toBe('Invalid validation payload type: unsupported');
    } finally {
      validator.stop();
      receiver.stop();
    }
  });
});

describe('schemaValidatorMachine missing component definitions', () => {
  const makeComponent = (id, kind, overrides = {}) => ({
    id,
    component: { kind, version: 'v1' },
    modelReference: { name: 'kubernetes' },
    configuration: {},
    ...overrides,
  });

  const podDefinition = {
    id: 'pod-def',
    metadata: { isAnnotation: false },
    component: {
      kind: 'Pod',
      version: 'v1',
      schema: JSON.stringify({ type: 'object', properties: { spec: { type: 'object' } } }),
    },
    modelReference: { name: 'kubernetes' },
  };

  const validate = async (validationPayload) => {
    const receiver = createActor(
      createMachine({
        initial: 'waiting',
        context: { validationResults: null },
        states: {
          waiting: {
            on: {
              [DATA_VALIDATOR_EVENTS.DESIGN_VALIDATION_DONE]: {
                target: 'received',
                actions: assign({
                  validationResults: ({ event }) => event.data.validationResults,
                }),
              },
            },
          },
          received: {},
        },
      }),
    );
    const validator = createActor(schemaValidatorMachine);

    receiver.start();
    validator.start();

    try {
      validator.send(
        dataValidatorCommands.validateData({ validationPayload, returnAddress: receiver }),
      );
      const snapshot = await waitFor(receiver, (state) => state.matches('received'));
      return snapshot.context.validationResults;
    } finally {
      validator.stop();
      receiver.stop();
    }
  };

  it('reports an error naming the component when its definition is unavailable', async () => {
    const results = await validate({
      validationPayloadType: 'design',
      design: { components: [makeComponent('component-1', 'Deployment')] },
      componentDefs: {},
    });

    expect(results['component-1'].componentDefinition).toBeUndefined();
    expect(results['component-1'].errors).toHaveLength(1);
    expect(results['component-1'].errors[0]).toMatchObject({
      instancePath: '',
      keyword: 'definitionUnavailable',
      params: { kind: 'Deployment', model: 'kubernetes', version: 'v1' },
    });
    expect(results['component-1'].errors[0].message).toContain('"Deployment"');
    expect(results['component-1'].errors[0].message).toContain('"kubernetes"');
    expect(results['component-1'].errors[0].message).toContain('"v1"');
  });

  it('validates components whose definitions loaded alongside ones that did not', async () => {
    const results = await validate({
      validationPayloadType: 'design',
      design: {
        components: [makeComponent('pod', 'Pod'), makeComponent('missing', 'Deployment')],
      },
      componentDefs: { [componentKey(podDefinition)]: podDefinition },
    });

    expect(results['pod'].errors ?? []).toHaveLength(0);
    expect(results['missing'].errors).toHaveLength(1);
  });

  it('still skips annotation components without a definition', async () => {
    const results = await validate({
      validationPayloadType: 'design',
      design: {
        components: [
          makeComponent('annotation-1', 'Comment', { metadata: { isAnnotation: true } }),
        ],
      },
      componentDefs: {},
    });

    expect(results['annotation-1']).toMatchObject({
      componentDefinition: undefined,
      errors: [],
    });
  });

  it('reports an error for a single component validated without a definition', async () => {
    const results = await validate({
      validationPayloadType: 'component',
      component: makeComponent('component-1', 'Deployment'),
      componentDef: undefined,
    });

    expect(results['component-1'].errors).toHaveLength(1);
    expect(results['component-1'].errors[0].keyword).toBe('definitionUnavailable');
  });
});
